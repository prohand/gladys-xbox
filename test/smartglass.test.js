import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PACKET_TYPES,
  buildDiscoveryRequest,
  buildPowerOnRequest,
  normalizeLiveId,
  parseDiscoveryResponse,
} from '../src/xbox/smartglass.js';
import { LIVE_ID, discoveryResponse } from './helpers/fakeXbox.js';

test('the discovery request is the 16-byte 0xDD00 packet', () => {
  assert.equal(buildDiscoveryRequest().toString('hex'), 'dd00000a000000000000000800000002');
});

test('the power on packet carries the Live ID as a null-terminated string', () => {
  const packet = buildPowerOnRequest(LIVE_ID.toLowerCase());
  assert.equal(packet.readUInt16BE(0), PACKET_TYPES.POWER_ON_REQUEST);
  assert.equal(packet.readUInt16BE(2), 2 + 16 + 1, 'payload length');
  assert.equal(packet.readUInt16BE(4), 0, 'version');
  assert.equal(packet.readUInt16BE(6), 16, 'string length');
  assert.equal(packet.subarray(8, 24).toString(), LIVE_ID, 'upper case');
  assert.equal(packet.at(-1), 0);
});

test('the power on packet refuses something that is not a Live ID', () => {
  assert.throws(() => buildPowerOnRequest('192.168.1.42'), /Invalid Live ID/);
});

test('a discovery response gives the name and the Live ID of its certificate', () => {
  assert.deepEqual(parseDiscoveryResponse(discoveryResponse({ name: 'Salon' })), {
    name: 'Salon',
    uuid: 'DE305D54-75B4-431B-ADB2-EB6B9E546014',
    liveId: LIVE_ID,
    consoleType: 'XboxOne',
    lastError: 0,
  });
});

test('anything else is not a discovery response', () => {
  assert.equal(parseDiscoveryResponse(buildDiscoveryRequest()), null);
  assert.equal(parseDiscoveryResponse(discoveryResponse().subarray(0, 20)), null, 'truncated');
  assert.equal(parseDiscoveryResponse(Buffer.alloc(0)), null);
  const badCertificate = parseDiscoveryResponse(
    discoveryResponse({ certificate: Buffer.from('not a certificate') }),
  );
  assert.equal(badCertificate.liveId, null);
});

test('Live IDs are normalized', () => {
  assert.equal(normalizeLiveId(' fd00112233445566 '), LIVE_ID);
  assert.equal(normalizeLiveId('FD0011223344556'), null);
  assert.equal(normalizeLiveId(42), null);
});
