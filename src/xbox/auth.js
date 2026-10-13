// -----------------------------------------------------------------------------
// Cloud channel, part 1: signing in to Xbox Live.
//
// Three tokens, each one bought with the previous one:
//   1. Microsoft account (OAuth2 authorization code, login.live.com): an access
//      token and a long-lived refresh token. The user clicks "Connect" in
//      Gladys, which relays the flow to onOAuthAuthorizeUrl / onOAuthCallback;
//   2. Xbox user token (user.auth.xboxlive.com), from the Microsoft token;
//   3. XSTS token (xsts.auth.xboxlive.com), from the user token. It carries the
//      user hash (uhs), the xuid and the gamertag, and every Xbox Live call
//      sends `Authorization: XBL3.0 x=<uhs>;<xsts token>`.
//
// Only the refresh token is stored (config key `oauth_refresh_token`, outside
// the config_schema: never shown, never sent to the browser). Everything else
// lives in memory and is rebuilt from it after a restart.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'xbox-auth' });

export const MICROSOFT_AUTHORIZE_URL = 'https://login.live.com/oauth20_authorize.srf';
export const MICROSOFT_TOKEN_URL = 'https://login.live.com/oauth20_token.srf';
export const XBOX_USER_AUTH_URL = 'https://user.auth.xboxlive.com/user/authenticate';
export const XBOX_XSTS_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize';

export const OAUTH_SCOPE = 'Xboxlive.signin Xboxlive.offline_access';

// Config key holding the refresh token (off-schema storage).
export const REFRESH_TOKEN_KEY = 'oauth_refresh_token';

// Renew a token this long before it expires, so a call never carries one that
// dies on the way.
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/** The account is not linked, or the link is dead: the user must reconnect. */
export class XboxAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XboxAuthError';
  }
}

async function readJson(response, what) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) {
    // Never log the body of a token endpoint as is: it may echo a token.
    const reason = body.error_description || body.error || body.XErr || response.statusText;
    const error = new Error(`${what} failed (${response.status}): ${reason}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

/**
 * Xbox Live authentication, for one Microsoft account.
 * @param {{ fetch?: typeof fetch, now?: () => number }} deps
 */
export function createXboxAuth({ fetch: fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let config = {};
  let pendingState = null;
  let microsoft = null; // { accessToken, expiresAt }
  let xsts = null; // { token, uhs, xuid, gamertag, expiresAt }
  let refreshToken = null;
  let onRefreshToken = async () => {};

  const fresh = (token) => token && token.expiresAt - EXPIRY_MARGIN_MS > now();

  async function microsoftToken(params) {
    const body = new URLSearchParams({
      client_id: config.client_id,
      scope: OAUTH_SCOPE,
      ...params,
    });
    if (config.client_secret) {
      body.set('client_secret', config.client_secret);
    }
    const response = await fetchImpl(MICROSOFT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const tokens = await readJson(response, 'Microsoft token request');
    microsoft = {
      accessToken: tokens.access_token,
      expiresAt: now() + Number(tokens.expires_in ?? 3600) * 1000,
    };
    if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
      refreshToken = tokens.refresh_token;
      await onRefreshToken(refreshToken);
    }
    xsts = null;
  }

  async function xboxPost(url, payload, what) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-xbl-contract-version': '1',
      },
      body: JSON.stringify(payload),
    });
    return readJson(response, what);
  }

  async function signInXboxLive() {
    const user = await xboxPost(
      XBOX_USER_AUTH_URL,
      {
        RelyingParty: 'http://auth.xboxlive.com',
        TokenType: 'JWT',
        Properties: {
          AuthMethod: 'RPS',
          SiteName: 'user.auth.xboxlive.com',
          // `d=` marks a token issued to a third-party (Azure) application.
          RpsTicket: `d=${microsoft.accessToken}`,
        },
      },
      'Xbox user authentication',
    );
    const authorization = await xboxPost(
      XBOX_XSTS_URL,
      {
        RelyingParty: 'http://xboxlive.com',
        TokenType: 'JWT',
        Properties: { UserTokens: [user.Token], SandboxId: 'RETAIL' },
      },
      'Xbox XSTS authorization',
    );
    const claims = authorization.DisplayClaims?.xui?.[0] ?? {};
    xsts = {
      token: authorization.Token,
      uhs: claims.uhs,
      xuid: claims.xid,
      gamertag: claims.gtg,
      expiresAt: Date.parse(authorization.NotAfter) || now() + 60 * 60 * 1000,
    };
    logger.info(`Signed in to Xbox Live${xsts.gamertag ? ` as ${xsts.gamertag}` : ''}`);
  }

  return {
    /** Apply a new configuration (client id/secret, stored refresh token). */
    setConfig(newConfig) {
      const changedClient =
        newConfig.client_id !== config.client_id ||
        newConfig.client_secret !== config.client_secret;
      config = newConfig;
      const stored = newConfig[REFRESH_TOKEN_KEY] || null;
      // A config without a token does not unlink a session signed in since
      // the last read (the token write may still be on its way); another
      // application does, its tokens are worthless.
      if (changedClient || (stored && stored !== refreshToken)) {
        refreshToken = stored;
        microsoft = null;
        xsts = null;
      }
    },

    /** Called with every new refresh token, to persist it. */
    onRefreshToken(callback) {
      onRefreshToken = callback;
    },

    /** An Azure application is configured. */
    get hasClient() {
      return Boolean(config.client_id);
    },

    /** A Microsoft account is linked (a refresh token is known). */
    get isLinked() {
      return Boolean(config.client_id && refreshToken);
    },

    /** Identity of the signed-in user, once signed in. */
    get identity() {
      return xsts ? { xuid: xsts.xuid, gamertag: xsts.gamertag } : null;
    },

    /** Step 1 of the Connect button: the Microsoft sign-in page. */
    authorizeUrl(redirectUri) {
      if (!config.client_id) {
        throw new Error('Fill in the Azure application (client) ID first, then save.');
      }
      pendingState = randomUUID();
      const params = new URLSearchParams({
        client_id: config.client_id,
        response_type: 'code',
        approval_prompt: 'auto',
        scope: OAUTH_SCOPE,
        redirect_uri: redirectUri,
        state: pendingState,
      });
      return `${MICROSOFT_AUTHORIZE_URL}?${params}`;
    },

    /** Step 2 of the Connect button: exchange the code, then sign in to Xbox Live. */
    async handleCallback({ code, state, redirectUri }) {
      if (!pendingState || state !== pendingState) {
        throw new Error('OAuth state mismatch: start the connection again.');
      }
      pendingState = null;
      await microsoftToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
      await signInXboxLive();
    },

    /**
     * The `Authorization` header of an Xbox Live call, renewing the tokens on
     * the way when needed.
     */
    async authorizationHeader() {
      if (!this.isLinked) {
        throw new XboxAuthError('No Microsoft account linked.');
      }
      if (!fresh(xsts)) {
        if (!fresh(microsoft)) {
          try {
            await microsoftToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
          } catch (err) {
            if (err.status === 400 || err.status === 401) {
              // invalid_grant: revoked, expired, or another client id.
              throw new XboxAuthError(`The Microsoft account link expired: ${err.message}`);
            }
            throw err;
          }
        }
        await signInXboxLive();
      }
      return `XBL3.0 x=${xsts.uhs};${xsts.token}`;
    },

    /** Forget the in-memory tokens (e.g. after a 401 from Xbox Live). */
    invalidate() {
      xsts = null;
    },
  };
}
