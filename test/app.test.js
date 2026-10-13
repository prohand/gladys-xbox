// -----------------------------------------------------------------------------
// The whole integration against the fake Gladys of the SDK, with a fake LAN
// (UDP) and a fake Xbox Live (fetch): what Gladys receives, end to end.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../src/app.js';
import { PACKET_TYPES, SMARTGLASS_PORT } from '../src/xbox/smartglass.js';
import {
  CLOUD_CONFIG,
  DEVICE,
  broadcastReply,
  consoleDevice,
  feature,
  start,
} from './helpers/start.js';
import { LIVE_ID, fakeFetch, fakeUdp, xboxLiveRoutes } from './helpers/fakeXbox.js';

const createdDevice = consoleDevice;

test('a console found by the LAN broadcast is published with its Live ID and address', async () => {
  const { gladys } = await start({ scan: [broadcastReply()] });

  assert.equal(gladys.fake.scans.length, 1);
  const device = createdDevice(gladys);
  assert.equal(device.name, 'Living room Xbox');
  assert.deepEqual(device.params, [
    { name: 'LIVE_ID', value: LIVE_ID },
    { name: 'CONSOLE_TYPE', value: 'XboxOne' },
    { name: 'IP_ADDRESS', value: '192.168.1.42' },
  ]);
  assert.equal(device.should_poll, true);
  // Local only: nothing to report on the cloud side, the status is fine.
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a console typed by hand is found by a unicast ping', async () => {
  const udp = fakeUdp({ '10.0.5.7': { name: 'Bedroom Xbox' } });
  const { gladys } = await start({ config: { console_addresses: '10.0.5.7, nonsense!' }, udp });

  assert.equal(createdDevice(gladys).name, 'Bedroom Xbox');
  assert.equal(udp.sent[0].address, '10.0.5.7');
  assert.equal(udp.sent[0].port, SMARTGLASS_PORT);
  assert.equal(udp.sent[0].payload.readUInt16BE(0), PACKET_TYPES.DISCOVERY_REQUEST);
});

test('a console of the Microsoft account is published, and merged with the LAN one', async () => {
  const fetch = fakeFetch(xboxLiveRoutes());
  const { gladys } = await start({ config: CLOUD_CONFIG, fetch, scan: [broadcastReply()] });

  const consoles = gladys.fake.discoveredDevices;
  assert.equal(consoles.length, 1, 'one console, one device');
  assert.equal(consoles[0].model, 'XboxSeriesX');
  assert.ok(consoles[0].params.some((p) => p.name === 'IP_ADDRESS'));
  assert.equal(gladys.fake.connectionStatus.connected, true);
  // The refresh token Microsoft rotated is persisted.
  assert.equal(gladys.fake.config.oauth_refresh_token, 'ms-refresh-2');
});

test('poll: a console answering on the LAN is on, served locally', async () => {
  const { gladys } = await start({ scan: [broadcastReply()] });

  assert.deepEqual(await gladys.fake.poll(createdDevice(gladys)), { success: true });
  assert.equal(gladys.fake.lastState(feature('power')), 1);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: DEVICE,
    transport: 'local',
  });
});

test('poll: a silent console is off', async () => {
  const udp = fakeUdp();
  const { gladys } = await start({ udp, scan: [broadcastReply()] });
  delete udp.consoles['192.168.1.42'];

  await gladys.fake.poll(createdDevice(gladys));
  assert.equal(gladys.fake.lastState(feature('power')), 0);
});

test('poll: the game being played comes from the cloud, and fires the scene triggers', async () => {
  const clock = { now: Date.parse('2026-10-13T20:00:00Z') };
  const routes = xboxLiveRoutes();
  const fetch = fakeFetch(routes);
  const { gladys } = await start({ config: CLOUD_CONFIG, fetch, scan: [broadcastReply()], clock });
  const device = createdDevice(gladys);

  await gladys.fake.poll(device);
  const title = gladys.fake.states.findLast(
    (s) => s.device_feature_external_id === feature('title'),
  );
  assert.equal(title.text, 'Minecraft');
  // First observation: nobody knows when that game started, no event.
  assert.deepEqual(gladys.fake.sceneEvents, []);

  // 45 minutes later the console is back on the home screen.
  clock.now += 45 * 60 * 1000;
  routes['GET https://userpresence.xboxlive.com/users/'] = xboxLiveRoutes({ title: null })[
    'GET https://userpresence.xboxlive.com/users/'
  ];
  await gladys.fake.poll(device);
  assert.deepEqual(gladys.fake.sceneEvents, [
    {
      key: 'title_stopped',
      data: { device: DEVICE, title_name: 'Minecraft', title_id: '1828326430', played_minutes: 45 },
    },
  ]);

  // Then a game starts.
  clock.now += 5 * 60 * 1000;
  routes['GET https://userpresence.xboxlive.com/users/'] = xboxLiveRoutes({
    title: { id: '219630713', name: 'Forza Horizon 5' },
  })['GET https://userpresence.xboxlive.com/users/'];
  await gladys.fake.poll(device);
  assert.deepEqual(gladys.fake.sceneEvents.at(-1), {
    key: 'title_started',
    data: { device: DEVICE, title_name: 'Forza Horizon 5', title_id: '219630713' },
  });
  assert.ok(gladys.fake.widgetRefreshes.includes('xbox_console'));
});

test('poll: without a local address the cloud serves the console, flagged degraded', async () => {
  const fetch = fakeFetch(xboxLiveRoutes({ powerState: 'ConnectedStandby' }));
  const { gladys } = await start({ config: CLOUD_CONFIG, fetch });

  await gladys.fake.poll(createdDevice(gladys));
  assert.equal(gladys.fake.lastState(feature('power')), 0, 'standby is off for Gladys');
  const entry = gladys.fake.transports.at(-1);
  assert.equal(entry.transport, 'cloud');
  assert.equal(entry.degraded, true);
  assert.ok(entry.message.fr);
});

test('poll: with "prefer local" off, the cloud is asked first', async () => {
  const udp = fakeUdp();
  const fetch = fakeFetch(xboxLiveRoutes());
  const { gladys } = await start({
    config: { ...CLOUD_CONFIG, GLADYS_PREFER_LOCAL: false },
    udp,
    fetch,
    scan: [broadcastReply()],
  });
  const sentBefore = udp.sent.length;

  await gladys.fake.poll(createdDevice(gladys));
  assert.equal(udp.sent.length, sentBefore, 'no LAN ping');
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: DEVICE,
    transport: 'cloud',
  });
});

test('power on goes through the LAN packet when the address is known', async () => {
  const udp = fakeUdp();
  const { gladys } = await start({ udp, scan: [broadcastReply()] });
  const device = createdDevice(gladys);

  const ack = await gladys.fake.setValue(
    device,
    device.features.find((f) => f.external_id === feature('power')),
    1,
  );
  assert.deepEqual(ack, { success: true });
  const powerOn = udp.sent.filter(
    (s) => s.payload.readUInt16BE(0) === PACKET_TYPES.POWER_ON_REQUEST,
  );
  assert.equal(powerOn.length, 3, 'sent a few times, it is UDP');
  assert.ok(powerOn[0].payload.includes(Buffer.from(LIVE_ID)));
});

test('power on falls back to the cloud without a local address', async () => {
  const fetch = fakeFetch(xboxLiveRoutes());
  const { gladys } = await start({ config: CLOUD_CONFIG, fetch });
  const device = createdDevice(gladys);

  await gladys.fake.setValue(device, { external_id: feature('power') }, 1);
  const command = fetch.requests.find((r) => r.url === 'https://xccs.xboxlive.com/commands');
  const body = JSON.parse(command.body);
  assert.equal(body.type, 'Power');
  assert.equal(body.command, 'WakeUp');
  assert.equal(body.linkedXboxId, LIVE_ID);
  assert.equal(command.headers.Authorization, 'XBL3.0 x=uhs1;xsts-token');
});

test('turning off without the cloud fails with a clear message', async () => {
  const { gladys } = await start({ scan: [broadcastReply()] });

  const ack = await gladys.fake.setValue(
    createdDevice(gladys),
    { external_id: feature('power') },
    0,
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /cloud channel/);
});

test('the remote keys go through the cloud', async () => {
  const fetch = fakeFetch(xboxLiveRoutes());
  const { gladys } = await start({ config: CLOUD_CONFIG, fetch });
  const device = createdDevice(gladys);

  await gladys.fake.setValue(device, { external_id: feature('volume-up') }, 1);
  await gladys.fake.setValue(device, { external_id: feature('guide') }, 1);
  await gladys.fake.setValue(device, { external_id: feature('volume-mute') }, 1);
  const commands = fetch.requests
    .filter((r) => r.url === 'https://xccs.xboxlive.com/commands')
    .map((r) => JSON.parse(r.body));
  assert.deepEqual(
    commands.map((c) => [c.type, c.command, c.parameters]),
    [
      ['Audio', 'Volume', [{ direction: 'Up', amount: 1 }]],
      ['Shell', 'InjectKey', [{ keyType: 'Nexus' }]],
      ['Audio', 'Mute', [{}]],
    ],
  );
  assert.equal(gladys.fake.lastState(feature('volume-mute')), 1);
});

test('Connect: authorization URL, then callback, then the consoles of the account', async () => {
  const fetch = fakeFetch(xboxLiveRoutes());
  const { gladys } = await start({ config: { client_id: 'app-id' }, fetch });
  assert.equal(gladys.fake.connectionStatus.connected, false, 'not linked yet');

  const redirectUri = 'https://gladys.local/oauth/callback';
  const { data } = await gladys.fake.oauthAuthorizeUrl('microsoft_account', redirectUri);
  const url = new URL(data.authorize_url);
  assert.equal(url.origin + url.pathname, 'https://login.live.com/oauth20_authorize.srf');
  assert.equal(url.searchParams.get('client_id'), 'app-id');
  assert.equal(url.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(url.searchParams.get('scope'), 'Xboxlive.signin Xboxlive.offline_access');

  const refused = await gladys.fake.oauthCallback('microsoft_account', {
    code: 'abc',
    state: 'forged',
    redirectUri,
  });
  assert.equal(refused.success, false, 'a forged state is refused');

  await gladys.fake.oauthAuthorizeUrl('microsoft_account', redirectUri);
  const state = new URL(
    (await gladys.fake.oauthAuthorizeUrl('microsoft_account', redirectUri)).data.authorize_url,
  ).searchParams.get('state');
  const ack = await gladys.fake.oauthCallback('microsoft_account', {
    code: 'abc',
    state,
    redirectUri,
  });
  assert.deepEqual(ack, { success: true });

  const token = fetch.requests.find((r) => r.url === 'https://login.live.com/oauth20_token.srf');
  assert.equal(token.body.get('grant_type'), 'authorization_code');
  assert.equal(token.body.get('code'), 'abc');
  assert.equal(gladys.fake.config.oauth_refresh_token, 'ms-refresh-2');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(createdDevice(gladys).model, 'XboxSeriesX');
});

test('a dead refresh token asks the user to reconnect', async () => {
  const routes = xboxLiveRoutes();
  routes['POST https://login.live.com/oauth20_token.srf'] = {
    status: 400,
    body: { error: 'invalid_grant', error_description: 'The token was revoked.' },
  };
  const { gladys } = await start({ config: CLOUD_CONFIG, fetch: fakeFetch(routes) });

  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Connect again/);
});

test('"Test the connection" reports both channels', async () => {
  const fetch = fakeFetch(xboxLiveRoutes());
  const { gladys } = await start({ config: CLOUD_CONFIG, fetch, scan: [broadcastReply()] });

  const { success, data } = await gladys.fake.action('test_connection', {});
  assert.equal(success, true);
  assert.match(
    data.message.en,
    /LAN: 1 console\(s\) answered: Living room Xbox \(192\.168\.1\.42\)/,
  );
  assert.match(data.message.en, /signed in as GladysFan, 1 console/);
  assert.match(data.message.fr, /Réseau local/);
});

test('a console created in Gladys keeps its address after a restart', async () => {
  const gladys = createFakeGladys({
    devices: [
      {
        name: 'Office Xbox',
        external_id: DEVICE,
        params: [
          { name: 'LIVE_ID', value: LIVE_ID },
          { name: 'IP_ADDRESS', value: '192.168.1.42' },
        ],
        features: [],
      },
    ],
  });
  const udp = fakeUdp({});
  createApp(gladys, { udp, fetch: fakeFetch({}), wait: async () => {} });
  await gladys.connect();

  // The broadcast found nothing (console off), the device is still there.
  assert.equal(createdDevice(gladys).name, 'Office Xbox');
  await gladys.fake.poll(gladys.fake.devices[0]);
  assert.equal(udp.sent.at(-1).address, '192.168.1.42');
  assert.equal(gladys.fake.lastState(feature('power')), 0);
});

test('the poll follows the refresh interval of the configuration', async () => {
  const clock = { now: 0 };
  const udp = fakeUdp();
  const { gladys } = await start({
    udp,
    scan: [broadcastReply()],
    clock,
    config: { poll_frequency: 120 },
  });
  const device = createdDevice(gladys);
  const pings = () =>
    udp.sent.filter((s) => s.payload.readUInt16BE(0) === PACKET_TYPES.DISCOVERY_REQUEST).length;

  const before = pings();
  await gladys.fake.poll(device);
  clock.now += 30 * 1000;
  await gladys.fake.poll(device); // not due
  clock.now += 90 * 1000;
  await gladys.fake.poll(device); // due
  assert.equal(pings() - before, 2);
});
