import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PACKET_TYPES } from '../src/xbox/smartglass.js';
import { fakeFetch, fakeUdp, xboxLiveRoutes } from './helpers/fakeXbox.js';
import { CLOUD_CONFIG, DEVICE, broadcastReply, start } from './helpers/start.js';

const commands = (fetch) =>
  fetch.requests
    .filter((r) => r.url === 'https://xccs.xboxlive.com/commands')
    .map((r) => JSON.parse(r.body));

test('wake_console: power on, then wait until the console answers', async () => {
  const clock = { now: 0 };
  const udp = fakeUdp();
  const { gladys } = await start({ udp, scan: [broadcastReply()], clock });
  const console = udp.consoles['192.168.1.42'];
  delete udp.consoles['192.168.1.42'];
  // The console wakes up when it receives the power on packet.
  const send = udp.send;
  udp.send = async (address, port, payload) => {
    if (payload.readUInt16BE(0) === PACKET_TYPES.POWER_ON_REQUEST) udp.consoles[address] = console;
    return send(address, port, payload);
  };

  const ack = await gladys.fake.sceneAction('wake_console', { device: DEVICE, wait_seconds: 30 });
  assert.deepEqual(ack, { success: true, data: { outputs: { awake: true } } });
});

test('wake_console: a console that never answers is an output, not a failure', async () => {
  const clock = { now: 0 };
  const udp = fakeUdp();
  const { gladys } = await start({ udp, scan: [broadcastReply()], clock });
  delete udp.consoles['192.168.1.42'];

  const ack = await gladys.fake.sceneAction('wake_console', { device: DEVICE, wait_seconds: 10 });
  assert.deepEqual(ack, { success: true, data: { outputs: { awake: false } } });
});

test('launch_game: the Store product id reaches the console', async () => {
  const fetch = fakeFetch(xboxLiveRoutes());
  const { gladys } = await start({ config: CLOUD_CONFIG, fetch });

  const ack = await gladys.fake.sceneAction('launch_game', {
    device: DEVICE,
    product_id: ' 9NBLGGH2JHXJ ',
  });
  assert.deepEqual(ack.data.outputs, { launched: true });
  assert.deepEqual(commands(fetch).at(-1).parameters, [{ oneStoreProductId: '9NBLGGH2JHXJ' }]);
});

test('launch_game without the cloud: launched is false', async () => {
  const { gladys } = await start({ scan: [broadcastReply()] });
  const ack = await gladys.fake.sceneAction('launch_game', { device: DEVICE, product_id: 'X' });
  assert.deepEqual(ack.data.outputs, { launched: false });
});

test('press_button: one InjectKey command', async () => {
  const fetch = fakeFetch(xboxLiveRoutes());
  const { gladys } = await start({ config: CLOUD_CONFIG, fetch });

  const ack = await gladys.fake.sceneAction('press_button', { device: DEVICE, button: 'Nexus' });
  assert.deepEqual(ack.data.outputs, { pressed: true });
  assert.deepEqual(commands(fetch).at(-1).parameters, [{ keyType: 'Nexus' }]);
});

test('an unknown console fails the action', async () => {
  const { gladys } = await start({ udp: fakeUdp({}) });
  const ack = await gladys.fake.sceneAction('press_button', { device: DEVICE, button: 'A' });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Unknown console/);
});

test('a scene action never fires a scene event (no loop)', async () => {
  const fetch = fakeFetch(xboxLiveRoutes());
  const { gladys } = await start({ config: CLOUD_CONFIG, fetch, scan: [broadcastReply()] });
  await gladys.fake.sceneAction('press_button', { device: DEVICE, button: 'A' });
  await gladys.fake.sceneAction('launch_game', { device: DEVICE, product_id: '9NBLGGH2JHXJ' });
  assert.deepEqual(gladys.fake.sceneEvents, []);
});
