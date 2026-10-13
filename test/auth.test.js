import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XboxAuthError, createXboxAuth } from '../src/xbox/auth.js';
import { fakeFetch, xboxLiveRoutes } from './helpers/fakeXbox.js';

const linked = { client_id: 'app', client_secret: 's3cret', oauth_refresh_token: 'ms-refresh-1' };

test('the header is built from the refresh token, then reused while fresh', async () => {
  const fetch = fakeFetch(xboxLiveRoutes());
  const auth = createXboxAuth({ fetch });
  const stored = [];
  auth.onRefreshToken(async (token) => stored.push(token));
  auth.setConfig(linked);

  assert.equal(await auth.authorizationHeader(), 'XBL3.0 x=uhs1;xsts-token');
  assert.equal(await auth.authorizationHeader(), 'XBL3.0 x=uhs1;xsts-token');
  assert.equal(fetch.requests.length, 3, 'Microsoft, user, XSTS: once');
  assert.deepEqual(stored, ['ms-refresh-2']);
  assert.deepEqual(auth.identity, { xuid: '2535400000000000', gamertag: 'GladysFan' });

  const [token, user] = fetch.requests;
  assert.equal(token.body.get('grant_type'), 'refresh_token');
  assert.equal(token.body.get('client_secret'), 's3cret');
  assert.equal(JSON.parse(user.body).Properties.RpsTicket, 'd=ms-access');
});

test('an expired XSTS token is renewed', async () => {
  const clock = { now: Date.parse('2026-10-13T20:00:00Z') };
  const routes = xboxLiveRoutes();
  routes['POST https://xsts.auth.xboxlive.com/xsts/authorize'].NotAfter = '2026-10-13T21:00:00Z';
  const fetch = fakeFetch(routes);
  const auth = createXboxAuth({ fetch, now: () => clock.now });
  auth.setConfig(linked);

  await auth.authorizationHeader();
  clock.now += 2 * 60 * 60 * 1000;
  await auth.authorizationHeader();
  assert.equal(fetch.requests.length, 6);
});

test('no account, or a revoked one, is an XboxAuthError', async () => {
  const unlinked = createXboxAuth({ fetch: fakeFetch({}) });
  unlinked.setConfig({ client_id: 'app' });
  await assert.rejects(unlinked.authorizationHeader(), XboxAuthError);

  const routes = xboxLiveRoutes();
  routes['POST https://login.live.com/oauth20_token.srf'] = {
    status: 400,
    body: { error: 'invalid_grant' },
  };
  const revoked = createXboxAuth({ fetch: fakeFetch(routes) });
  revoked.setConfig(linked);
  await assert.rejects(revoked.authorizationHeader(), XboxAuthError);
});

test('the authorization URL needs a client id', () => {
  const auth = createXboxAuth({ fetch: fakeFetch({}) });
  auth.setConfig({});
  assert.throws(() => auth.authorizeUrl('https://gladys/cb'), /client\) ID/);
});

test('a config read without the token does not drop a fresh session', async () => {
  const auth = createXboxAuth({ fetch: fakeFetch(xboxLiveRoutes()) });
  auth.setConfig(linked);
  await auth.authorizationHeader();
  auth.setConfig({ client_id: 'app', client_secret: 's3cret', oauth_refresh_token: '' });
  assert.equal(auth.isLinked, true);
  auth.setConfig({ client_id: 'other-app' });
  assert.equal(auth.isLinked, false, 'another application: the tokens are worthless');
});
