// -----------------------------------------------------------------------------
// Local channel: SmartGlass over UDP, on the LAN.
//
// The integration runs in a bridge container: a broadcast it emits never
// reaches the LAN, and the console answers a broadcast in unicast towards the
// emitter. So the broadcast discovery goes through the Gladys core
// (`scanNetwork('udp-active-broadcast')`, manifest `network_discovery`), and
// everything else — a ping to a known address, the power on packet — is plain
// unicast, which crosses the NAT both ways.
// -----------------------------------------------------------------------------

import dgram from 'node:dgram';
import { createLogger } from '@gladysassistant/integration-sdk';
import {
  SMARTGLASS_PORT,
  buildDiscoveryRequest,
  buildPowerOnRequest,
  parseDiscoveryResponse,
} from './smartglass.js';

const logger = createLogger({ name: 'xbox-local' });

// A console on the LAN answers within a few milliseconds; past this delay it
// is off (or unreachable, which the protocol cannot tell apart).
export const PING_TIMEOUT_MS = 1500;

// The power on packet is fire-and-forget UDP: send it a few times, like the
// official app, so one lost datagram does not leave the console asleep.
export const POWER_ON_ATTEMPTS = 3;
const POWER_ON_INTERVAL_MS = 300;

// The core admits 1 active scan per 10 s per integration.
const SCAN_TIMEOUT_SECONDS = 3;

/**
 * Unicast UDP helper. `createSocket` is injectable for the tests.
 */
export function createUdpTransport({ createSocket = () => dgram.createSocket('udp4') } = {}) {
  return {
    /** Send one datagram and resolve the first reply, or null after `timeoutMs`. */
    request(address, port, payload, timeoutMs) {
      return new Promise((resolve) => {
        const socket = createSocket();
        let done = false;
        const finish = (value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try {
            socket.close();
          } catch {
            // already closed
          }
          resolve(value);
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        socket.on('message', (message) => finish(message));
        socket.on('error', (err) => {
          logger.debug(`UDP error towards ${address}: ${err.message}`);
          finish(null);
        });
        socket.send(payload, port, address, (err) => {
          if (err) {
            logger.debug(`UDP send towards ${address} failed: ${err.message}`);
            finish(null);
          }
        });
      });
    },

    /** Send one datagram, no reply expected. */
    send(address, port, payload) {
      return new Promise((resolve, reject) => {
        const socket = createSocket();
        socket.on('error', () => {});
        socket.send(payload, port, address, (err) => {
          try {
            socket.close();
          } catch {
            // already closed
          }
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The local channel, on top of a UDP transport.
 * @param {{ udp: ReturnType<typeof createUdpTransport>, wait?: (ms: number) => Promise<void> }} deps
 */
export function createLocalChannel({ udp, wait = sleep }) {
  return {
    /**
     * Ask one console whether it is there.
     * @returns {Promise<ReturnType<typeof parseDiscoveryResponse>>} its answer, or null (off)
     */
    async ping(address) {
      const reply = await udp.request(
        address,
        SMARTGLASS_PORT,
        buildDiscoveryRequest(),
        PING_TIMEOUT_MS,
      );
      return reply ? parseDiscoveryResponse(reply) : null;
    },

    /** Send the power on packet to one console (needs the instant-on power mode). */
    async powerOn(address, liveId) {
      const payload = buildPowerOnRequest(liveId);
      for (let attempt = 0; attempt < POWER_ON_ATTEMPTS; attempt += 1) {
        if (attempt > 0) await wait(POWER_ON_INTERVAL_MS);
        await udp.send(address, SMARTGLASS_PORT, payload);
      }
      logger.info(`Power on packet sent to ${address}`);
    },

    /**
     * Broadcast discovery through the Gladys core, plus a unicast ping to each
     * address typed by the user (a console on another subnet, a router that
     * drops broadcasts).
     * @returns {Promise<Array<{ address: string, name: string, liveId: string, consoleType: string }>>}
     */
    async discover(gladys, extraAddresses = []) {
      const found = new Map();
      const add = (address, response) => {
        if (response?.liveId && !found.has(response.liveId)) {
          found.set(response.liveId, { address, ...response });
        }
      };

      try {
        const replies = await gladys.scanNetwork('udp-active-broadcast', {
          port: SMARTGLASS_PORT,
          payload: buildDiscoveryRequest(),
          timeoutSeconds: SCAN_TIMEOUT_SECONDS,
        });
        for (const { source_ip: address, payload_base64: payload } of replies) {
          add(address, parseDiscoveryResponse(Buffer.from(payload, 'base64')));
        }
      } catch (err) {
        // 429 (one scan per 10 s) or an older core: the typed addresses still work.
        logger.warn(`Broadcast discovery failed: ${err.message}`);
      }

      for (const address of extraAddresses) {
        add(address, await this.ping(address));
      }
      return [...found.values()];
    },
  };
}
