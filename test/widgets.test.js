import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { CONSOLE_WIDGET } from '../src/widgets.js';
import { fakeFetch, fakeUdp, xboxLiveRoutes } from './helpers/fakeXbox.js';
import {
  CLOUD_CONFIG,
  DEVICE,
  broadcastReply,
  consoleDevice,
  feature,
  start,
} from './helpers/start.js';

async function content(gladys, settings = {}) {
  const ack = await gladys.fake.widgetGet(CONSOLE_WIDGET, {
    settings,
    language: 'fr',
    units: 'metric',
  });
  assert.equal(ack.success, true, ack.error);
  // [] = rendered exactly as sent, nothing dropped or truncated.
  assert.deepEqual(validateWidgetContent(ack.data.content), []);
  return ack.data.content;
}

const buttons = (widget) => widget.components.filter((c) => c.type === 'button');
const statusValue = (widget, en) =>
  widget.components.find((c) => c.type === 'status').items.find((i) => i.label.en === en).value;

test('no console yet: the widget says how to get one', async () => {
  const { gladys } = await start();
  const widget = await content(gladys);
  assert.equal(widget.components[0].type, 'text');
});

test('a console off: status and a "Turn on" button bound to the power feature', async () => {
  const udp = fakeUdp();
  const { gladys } = await start({ udp, scan: [broadcastReply()] });
  delete udp.consoles['192.168.1.42'];
  await gladys.fake.poll(consoleDevice(gladys));

  const widget = await content(gladys, { device: DEVICE });
  assert.deepEqual(statusValue(widget, 'Power'), { en: 'Off', fr: 'Éteinte' });
  assert.deepEqual(
    buttons(widget).map((b) => [b.device_feature, b.value]),
    [[feature('power'), 1]],
  );
});

test('a console on, with the cloud: game, account and the quick buttons', async () => {
  const fetch = fakeFetch(xboxLiveRoutes());
  const { gladys } = await start({ config: CLOUD_CONFIG, fetch, scan: [broadcastReply()] });
  await gladys.fake.poll(consoleDevice(gladys));

  const widget = await content(gladys);
  assert.equal(statusValue(widget, 'Playing'), 'Minecraft');
  assert.equal(statusValue(widget, 'Account'), 'GladysFan');
  assert.deepEqual(statusValue(widget, 'Connection'), { en: 'Local', fr: 'Locale' });
  assert.deepEqual(
    buttons(widget).map((b) => b.action?.key ?? `${b.device_feature}=${b.value}`),
    ['home', 'play_pause', `${feature('power')}=0`],
  );

  const home = await gladys.fake.widgetAction(CONSOLE_WIDGET, 'home', { device: DEVICE }, {});
  assert.equal(home.success, true);
  const playPause = await gladys.fake.widgetAction(
    CONSOLE_WIDGET,
    'play_pause',
    { device: DEVICE },
    {},
  );
  assert.equal(playPause.success, true);
  const sent = fetch.requests
    .filter((r) => r.url === 'https://xccs.xboxlive.com/commands')
    .map((r) => JSON.parse(r.body).command);
  // The console reported "Paused": the toggle plays.
  assert.deepEqual(sent, ['GoHome', 'Play']);
});

test('an unknown widget action fails', async () => {
  const { gladys } = await start({ scan: [broadcastReply()] });
  const ack = await gladys.fake.widgetAction(CONSOLE_WIDGET, 'nope', { device: DEVICE }, {});
  assert.equal(ack.success, false);
});
