// A running integration against the fake Gladys of the SDK and a fake network.

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../../src/app.js';
import { SMARTGLASS_PORT } from '../../src/xbox/smartglass.js';
import { LIVE_ID, discoveryResponse, fakeFetch, fakeUdp } from './fakeXbox.js';

export const DEVICE = `ext:test-integration:xbox:${LIVE_ID.toLowerCase()}`;
export const feature = (key) => `${DEVICE}:${key}`;

export const CLOUD_CONFIG = {
  client_id: 'app-id',
  client_secret: 'app-secret',
  oauth_refresh_token: 'ms-refresh-1',
};

/** What the core relays from a console answering the LAN broadcast. */
export const broadcastReply = (address = '192.168.1.42') => ({
  source_ip: address,
  source_port: SMARTGLASS_PORT,
  payload_base64: discoveryResponse().toString('base64'),
});

export async function start({
  config = {},
  udp = fakeUdp(),
  fetch = fakeFetch({}),
  scan = [],
  devices = [],
  clock,
} = {}) {
  const gladys = createFakeGladys({
    config,
    devices,
    scanResults: { 'udp-active-broadcast': scan },
  });
  const app = createApp(gladys, {
    udp,
    fetch,
    wait: async () => {
      if (clock) clock.now += 2000;
    },
    now: clock ? () => clock.now : undefined,
  });
  await gladys.connect();
  return { gladys, app, udp, fetch };
}

export const consoleDevice = (gladys) =>
  gladys.fake.discoveredDevices.find((d) => d.external_id === DEVICE);
