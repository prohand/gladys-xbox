// -----------------------------------------------------------------------------
// Cloud channel, part 2: the Xbox Live services.
//
//   - xccs.xboxlive.com (Xbox Console Control Service, the "remote features"
//     of the Xbox app): the consoles of the account, their power state, and
//     the commands — power, volume, media keys, controller buttons, launching
//     a game. The console must allow it: Settings > Devices & connections >
//     Remote features > "Enable remote features";
//   - userpresence.xboxlive.com: what the signed-in user is playing.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeLiveId } from './smartglass.js';

const logger = createLogger({ name: 'xbox-cloud' });

export const XCCS_URL = 'https://xccs.xboxlive.com';
export const PRESENCE_URL = 'https://userpresence.xboxlive.com';

// The dashboard ("Home") is a title too: it is not a game being played.
export const HOME_TITLE_IDS = new Set(['750323071']);

// Commands of the console control service: { type, command, parameters }.
export const COMMANDS = {
  WAKE_UP: { type: 'Power', command: 'WakeUp' },
  TURN_OFF: { type: 'Power', command: 'TurnOff' },
  REBOOT: { type: 'Power', command: 'Reboot' },
  MUTE: { type: 'Audio', command: 'Mute' },
  UNMUTE: { type: 'Audio', command: 'Unmute' },
  VOLUME_UP: { type: 'Audio', command: 'Volume', parameters: [{ direction: 'Up', amount: 1 }] },
  VOLUME_DOWN: { type: 'Audio', command: 'Volume', parameters: [{ direction: 'Down', amount: 1 }] },
  PLAY: { type: 'Media', command: 'Play' },
  PAUSE: { type: 'Media', command: 'Pause' },
  PREVIOUS: { type: 'Media', command: 'Previous' },
  NEXT: { type: 'Media', command: 'Next' },
  GO_HOME: { type: 'Shell', command: 'GoHome' },
  GO_BACK: { type: 'Shell', command: 'GoBack' },
};

// Controller buttons the console accepts through `Shell / InjectKey`.
export const BUTTONS = ['A', 'B', 'X', 'Y', 'Up', 'Down', 'Left', 'Right', 'Nexus', 'View', 'Menu'];

export function buttonCommand(button) {
  if (!BUTTONS.includes(button)) {
    throw new Error(`Unknown controller button: ${button}`);
  }
  return { type: 'Shell', command: 'InjectKey', parameters: [{ keyType: button }] };
}

export function launchCommand(productId) {
  return {
    type: 'Shell',
    command: 'ActivateApplicationWithOneStoreProductId',
    parameters: [{ oneStoreProductId: productId }],
  };
}

/** Power state of the control service → 'on' | 'standby' | 'off'. */
export function normalizePowerState(powerState) {
  switch (powerState) {
    case 'On':
      return 'on';
    case 'ConnectedStandby':
    case 'SystemUpdate':
      return 'standby';
    default:
      return 'off';
  }
}

/**
 * Xbox Live client.
 * @param {{ auth: ReturnType<import('./auth.js').createXboxAuth>, fetch?: typeof fetch }} deps
 */
export function createXboxCloud({ auth, fetch: fetchImpl = globalThis.fetch }) {
  async function call(url, { method = 'GET', body, contract = '4', headers = {} } = {}) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetchImpl(url, {
        method,
        headers: {
          Authorization: await auth.authorizationHeader(),
          'x-xbl-contract-version': contract,
          skillplatform: 'RemoteManagement',
          Accept: 'application/json',
          'Accept-Language': 'en-US',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (response.status === 401 && attempt === 0) {
        // The XSTS token was revoked early: sign in again once.
        auth.invalidate();
        continue;
      }
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Xbox Live ${method} ${new URL(url).pathname} failed (${response.status})`);
      }
      return text ? JSON.parse(text) : {};
    }
    throw new Error('Xbox Live refused the session twice');
  }

  return {
    /**
     * Consoles of the account.
     * @returns {Promise<Array<{ liveId: string, name: string, consoleType: string, power: string }>>}
     */
    async listConsoles() {
      const body = await call(
        `${XCCS_URL}/lists/devices?queryCurrentDevice=false&includeStorageDevices=true`,
      );
      return (body.result ?? [])
        .map((console) => ({
          liveId: normalizeLiveId(console.id),
          name: console.name,
          consoleType: console.consoleType,
          power: normalizePowerState(console.powerState),
          remoteManagementEnabled: console.remoteManagementEnabled !== false,
        }))
        .filter((console) => console.liveId);
    },

    /** Power and focus of one console. */
    async consoleStatus(liveId) {
      const body = await call(`${XCCS_URL}/consoles/${liveId}`);
      return {
        power: normalizePowerState(body.powerState),
        playbackState: body.playbackState ?? null,
        focusAppAumid: body.focusAppAumid ?? null,
      };
    },

    /** Send one command (see COMMANDS, buttonCommand, launchCommand). */
    async sendCommand(liveId, { type, command, parameters = [{}] }) {
      logger.info(`Command ${type}/${command} -> ${liveId}`);
      const body = await call(`${XCCS_URL}/commands`, {
        method: 'POST',
        body: {
          destination: 'Xbox',
          type,
          command,
          sessionId: randomUUID(),
          sourceId: 'com.microsoft.smartglass',
          parameters,
          linkedXboxId: liveId,
        },
      });
      const errorCode = body.result?.errorCode ?? body.status?.errorCode;
      if (errorCode && errorCode !== 'OK') {
        throw new Error(`The console refused ${type}/${command}: ${errorCode}`);
      }
      return body;
    },

    /**
     * What the signed-in user plays: the title shown full screen, if any.
     * @returns {Promise<{ online: boolean, title: { id: string, name: string } | null }>}
     */
    async presence() {
      const identity = auth.identity;
      if (!identity?.xuid) {
        await auth.authorizationHeader();
      }
      const xuid = auth.identity?.xuid;
      if (!xuid) {
        return { online: false, title: null };
      }
      const body = await call(`${PRESENCE_URL}/users/xuid(${xuid})?level=all`, { contract: '3' });
      const titles = (body.devices ?? []).flatMap((device) => device.titles ?? []);
      const focused = titles.find(
        (title) => title.placement === 'Full' && !HOME_TITLE_IDS.has(String(title.id)),
      );
      return {
        online: body.state === 'Online',
        title: focused ? { id: String(focused.id), name: focused.name } : null,
      };
    },
  };
}
