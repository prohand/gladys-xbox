import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseAddresses } from '../src/config.js';

test('an empty config gets the defaults', () => {
  const config = normalizeConfig();
  assert.equal(config.poll_frequency, DEFAULT_CONFIG.poll_frequency);
  assert.deepEqual(config.addresses, []);
  assert.equal(config.GLADYS_PREFER_LOCAL, true);
});

test('form values are typed and bounded', () => {
  const config = normalizeConfig({
    poll_frequency: '5',
    client_id: ' app ',
    GLADYS_PREFER_LOCAL: false,
  });
  assert.equal(config.poll_frequency, 30, 'Gladys polls every 30 s at most');
  assert.equal(config.client_id, 'app');
  assert.equal(config.GLADYS_PREFER_LOCAL, false);
  assert.equal(normalizeConfig({ poll_frequency: 'abc' }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 99999 }).poll_frequency, 3600);
});

test('console addresses: any separator, invalid entries dropped, no duplicates', () => {
  assert.deepEqual(parseAddresses('192.168.1.42, 192.168.1.43;xbox.lan\n192.168.1.42 http://x'), [
    '192.168.1.42',
    '192.168.1.43',
    'xbox.lan',
  ]);
  assert.deepEqual(parseAddresses(undefined), []);
});
