// -----------------------------------------------------------------------------
// Fake network for the tests: no socket is opened, no request leaves.
//
//   - fakeUdp(): the UDP transport of src/xbox/local.js, answering like a
//     console on the LAN (discovery response) and recording what was sent;
//   - fakeFetch(): Microsoft and Xbox Live endpoints, served from a table of
//     routes, recording every request;
//   - discoveryResponse(): a real 0xDD01 datagram, certificate included.
// -----------------------------------------------------------------------------

import { PACKET_TYPES } from '../../src/xbox/smartglass.js';

export const LIVE_ID = 'FD00112233445566';

// Self-signed certificate whose subject is CN=FD00112233445566, the way a
// console presents its Live ID.
export const CONSOLE_CERTIFICATE = Buffer.from(
  'MIIBjTCCATOgAwIBAgIUdvyXV3WrIEnNWDjgXQb9CXIh9jowCgYIKoZIzj0EAwIwGzEZMBcGA1UEAwwQRkQwMDExMjIzMzQ0NTU2NjAgFw0yNjEwMTMxOTE1MDhaGA8yMTI2MDkxOTE5MTUwOFowGzEZMBcGA1UEAwwQRkQwMDExMjIzMzQ0NTU2NjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABMTUpxXN2HNNjFoeLf3OJ2pxiX2nbzgr9PmkNDp+6ZKGL2GrpsSr26WexPp3CUt/ny6MoaVGgDdsAlGkypbNndGjUzBRMB0GA1UdDgQWBBRUiPkkvLkig2lhtapEoxvOvaIn6DAfBgNVHSMEGDAWgBRUiPkkvLkig2lhtapEoxvOvaIn6DAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0gAMEUCIFASmhVRmk96BAx/uRzN8t/Q+jiCslkwVuDUa6O4YRTaAiEAsCYxDq/1Tc5JgSbkGwzZyu7d8jmLXc0Mkry8E82RL6M=',
  'base64',
);

function sgString(text) {
  const bytes = Buffer.from(text, 'utf8');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length, 0);
  return Buffer.concat([length, bytes, Buffer.from([0])]);
}

/** A discovery response, as a console sends it. */
export function discoveryResponse({
  name = 'Living room Xbox',
  certificate = CONSOLE_CERTIFICATE,
} = {}) {
  const head = Buffer.alloc(6);
  head.writeUInt32BE(0, 0); // flags
  head.writeUInt16BE(1, 4); // XboxOne
  const lastError = Buffer.alloc(4);
  const certLength = Buffer.alloc(2);
  certLength.writeUInt16BE(certificate.length, 0);
  const payload = Buffer.concat([
    head,
    sgString(name),
    sgString('DE305D54-75B4-431B-ADB2-EB6B9E546014'),
    lastError,
    certLength,
    certificate,
  ]);
  const header = Buffer.alloc(6);
  header.writeUInt16BE(PACKET_TYPES.DISCOVERY_RESPONSE, 0);
  header.writeUInt16BE(payload.length, 2);
  header.writeUInt16BE(2, 4);
  return Buffer.concat([header, payload]);
}

/**
 * Fake UDP transport. `consoles` maps an address to the console answering
 * there; delete an entry to turn that console off.
 */
export function fakeUdp(consoles = { '192.168.1.42': { name: 'Living room Xbox' } }) {
  const sent = [];
  return {
    consoles,
    sent,
    async request(address, port, payload) {
      sent.push({ address, port, payload });
      const console = consoles[address];
      return console ? discoveryResponse(console) : null;
    },
    async send(address, port, payload) {
      sent.push({ address, port, payload });
    },
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    async text() {
      return body === undefined ? '' : JSON.stringify(body);
    },
  };
}

/**
 * Fake fetch. `routes` maps "METHOD url-prefix" to a body, or to a function
 * (request) => body | { status, body }.
 */
export function fakeFetch(routes) {
  const requests = [];
  const fetch = async (url, options = {}) => {
    const method = options.method ?? 'GET';
    const request = {
      method,
      url: String(url),
      headers: options.headers ?? {},
      body: options.body,
    };
    requests.push(request);
    const key = Object.keys(routes)
      .filter((route) => {
        const [routeMethod, prefix] = route.split(' ');
        return routeMethod === method && request.url.startsWith(prefix);
      })
      .sort((a, b) => b.length - a.length)[0];
    if (!key) {
      return jsonResponse(404, { error: `no route for ${method} ${url}` });
    }
    const answer = typeof routes[key] === 'function' ? routes[key](request) : routes[key];
    if (answer && typeof answer.status === 'number' && 'body' in answer) {
      return jsonResponse(answer.status, answer.body);
    }
    return jsonResponse(200, answer);
  };
  fetch.requests = requests;
  return fetch;
}

/** Routes of a healthy Microsoft account with one console. */
export function xboxLiveRoutes({
  powerState = 'On',
  title = { id: '1828326430', name: 'Minecraft' },
} = {}) {
  return {
    'POST https://login.live.com/oauth20_token.srf': {
      access_token: 'ms-access',
      refresh_token: 'ms-refresh-2',
      expires_in: 3600,
    },
    'POST https://user.auth.xboxlive.com/user/authenticate': {
      Token: 'user-token',
      DisplayClaims: { xui: [{ uhs: 'uhs1' }] },
    },
    'POST https://xsts.auth.xboxlive.com/xsts/authorize': {
      Token: 'xsts-token',
      NotAfter: '2099-01-01T00:00:00Z',
      DisplayClaims: { xui: [{ uhs: 'uhs1', xid: '2535400000000000', gtg: 'GladysFan' }] },
    },
    'GET https://xccs.xboxlive.com/lists/devices': {
      result: [{ id: LIVE_ID, name: 'Living room Xbox', consoleType: 'XboxSeriesX', powerState }],
    },
    'GET https://xccs.xboxlive.com/consoles/': { powerState, playbackState: 'Paused' },
    'POST https://xccs.xboxlive.com/commands': { result: 'OK' },
    'GET https://userpresence.xboxlive.com/users/': {
      state: 'Online',
      devices: [
        {
          type: 'Scarlett',
          titles: [
            { id: '750323071', name: 'Home', placement: 'Background' },
            ...(title ? [{ ...title, placement: 'Full' }] : []),
          ],
        },
      ],
    },
  };
}
