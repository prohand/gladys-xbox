// -----------------------------------------------------------------------------
// Xbox SmartGlass "simple" packets: the unencrypted part of the protocol.
//
// The console listens on UDP 5050. Two exchanges need no session nor crypto,
// and they are all the local channel uses:
//   - discovery: a 0xDD00 request, the console answers 0xDD01 with its name,
//     its type and a certificate whose subject CN is its Live ID. A console
//     that answers is on (or in instant-on standby: it still answers);
//   - power on: a 0xDD02 packet carrying the Live ID. Only a console set to
//     "Sleep" / instant-on power mode listens for it.
// Turning the console off, the volume and the media keys need the encrypted
// session (ECDH, signed and encrypted messages): those go through the cloud.
//
// Layout of a simple packet (big endian):
//   u16 packet type | u16 payload length | u16 version | payload
// A string is "SGString": u16 length, the bytes, a 0x00 terminator.
// -----------------------------------------------------------------------------

import { X509Certificate } from 'node:crypto';

export const SMARTGLASS_PORT = 5050;

export const PACKET_TYPES = {
  DISCOVERY_REQUEST: 0xdd00,
  DISCOVERY_RESPONSE: 0xdd01,
  POWER_ON_REQUEST: 0xdd02,
};

// Client type announced in the discovery request (the value the official
// Android app sends). The console answers whatever the type.
const CLIENT_TYPE_ANDROID = 8;

// Console type announced in the discovery response.
const CONSOLE_TYPES = { 1: 'XboxOne', 2: 'Xbox360' };

const HEADER_SIZE = 6;

// A Live ID is a 16-character hexadecimal identifier, e.g. FD00112233445566.
const LIVE_ID_PATTERN = /^[0-9A-F]{16}$/;

/**
 * Normalize a Live ID typed by a user or read from a certificate.
 * @param {unknown} value
 * @returns {string | null} upper case Live ID, or null when it is not one
 */
export function normalizeLiveId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const liveId = value.trim().toUpperCase();
  return LIVE_ID_PATTERN.test(liveId) ? liveId : null;
}

function packet(type, payload) {
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(payload.length, 2);
  header.writeUInt16BE(0, 4); // version 0 for the unencrypted packets
  return Buffer.concat([header, payload]);
}

function sgString(text) {
  const bytes = Buffer.from(text, 'utf8');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length, 0);
  return Buffer.concat([length, bytes, Buffer.from([0])]);
}

/**
 * Discovery request (0xDD00): flags, client type, min and max protocol version.
 * @returns {Buffer}
 */
export function buildDiscoveryRequest() {
  const payload = Buffer.alloc(10);
  payload.writeUInt32BE(0, 0); // flags
  payload.writeUInt16BE(CLIENT_TYPE_ANDROID, 4);
  payload.writeUInt16BE(0, 6); // minimum version
  payload.writeUInt16BE(2, 8); // maximum version
  return packet(PACKET_TYPES.DISCOVERY_REQUEST, payload);
}

/**
 * Power on request (0xDD02) for one console.
 * @param {string} liveId
 * @returns {Buffer}
 */
export function buildPowerOnRequest(liveId) {
  const normalized = normalizeLiveId(liveId);
  if (!normalized) {
    throw new Error(`Invalid Live ID: ${liveId}`);
  }
  return packet(PACKET_TYPES.POWER_ON_REQUEST, sgString(normalized));
}

class Reader {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  ensure(size) {
    if (this.offset + size > this.buffer.length) {
      throw new Error('Truncated SmartGlass packet');
    }
  }

  u16() {
    this.ensure(2);
    const value = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  u32() {
    this.ensure(4);
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  bytes(size) {
    this.ensure(size);
    const value = this.buffer.subarray(this.offset, this.offset + size);
    this.offset += size;
    return value;
  }

  sgString() {
    const length = this.u16();
    const value = this.bytes(length).toString('utf8');
    this.bytes(1); // 0x00 terminator
    return value;
  }
}

/**
 * Read the Live ID out of the console certificate (its subject CN).
 * @param {Buffer} der
 * @returns {string | null}
 */
export function liveIdFromCertificate(der) {
  try {
    const { subject } = new X509Certificate(der);
    const match = /CN=([^\n,]+)/.exec(subject);
    return match ? normalizeLiveId(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Parse a discovery response (0xDD01).
 * @param {Buffer} buffer raw datagram
 * @returns {{ name: string, uuid: string, liveId: string | null, consoleType: string, lastError: number } | null}
 *   null when the datagram is not a discovery response
 */
export function parseDiscoveryResponse(buffer) {
  try {
    const reader = new Reader(buffer);
    if (reader.u16() !== PACKET_TYPES.DISCOVERY_RESPONSE) {
      return null;
    }
    reader.u16(); // payload length
    reader.u16(); // version
    reader.u32(); // flags
    const type = reader.u16();
    const name = reader.sgString();
    const uuid = reader.sgString();
    const lastError = reader.u32();
    const certificate = reader.bytes(reader.u16());
    return {
      name,
      uuid,
      liveId: liveIdFromCertificate(certificate),
      consoleType: CONSOLE_TYPES[type] ?? 'XboxOne',
      lastError,
    };
  } catch {
    return null;
  }
}
