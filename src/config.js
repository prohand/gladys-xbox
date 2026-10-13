// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the `config_schema`
// declared in `gladys-assistant-integration.json`. The SDK fetches it for you
// (`gladys.getConfig()`) and notifies you of every change through
// `gladys.onConfigUpdated()`.
//
// This module only provides defaults and normalizes the received object, so the
// rest of the code never has to deal with `undefined`.
// -----------------------------------------------------------------------------

import { isIP } from 'node:net';
import { REFRESH_TOKEN_KEY } from './xbox/auth.js';

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (checked by test/manifest.test.js).
export const DEFAULT_CONFIG = {
  // Console addresses typed by hand, for consoles the broadcast discovery
  // cannot see (another subnet, a router that filters broadcasts).
  console_addresses: '',
  // Azure application of the user (cloud channel). The secret is optional: a
  // "public client" application signs in without one.
  client_id: '',
  client_secret: '',
  // Seconds between two reads of a console. Gladys polls every 30 s at most;
  // slower intervals are applied by skipping polls (see createPoller in
  // src/devices/index.js).
  poll_frequency: 60,
  // Reserved key (NOT in config_schema): because the manifest declares both
  // 'local' and 'cloud' in its `transports` field, Gladys shows a standard
  // "Prefer the local connection" toggle and sends the user's choice here.
  // Read-only for the integration; defaults to true.
  GLADYS_PREFER_LOCAL: true,
  // Off-schema storage of the Microsoft refresh token (see src/xbox/auth.js).
  [REFRESH_TOKEN_KEY]: '',
};

// A host name as a user types it (no scheme, no port).
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * Split the `console_addresses` field: comma, semicolon, space or new line.
 * Invalid entries are dropped.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseAddresses(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  const addresses = raw
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry && (isIP(entry) === 4 || HOSTNAME_PATTERN.test(entry)));
  return [...new Set(addresses)];
}

const text = (value, fallback) => (typeof value === 'string' ? value.trim() : fallback);

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const pollFrequency = Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    console_addresses: text(raw.console_addresses, DEFAULT_CONFIG.console_addresses),
    addresses: parseAddresses(raw.console_addresses),
    client_id: text(raw.client_id, DEFAULT_CONFIG.client_id),
    client_secret: text(raw.client_secret, DEFAULT_CONFIG.client_secret),
    // Force the types: config may arrive as strings from a form.
    poll_frequency: Number.isFinite(pollFrequency)
      ? Math.min(3600, Math.max(30, pollFrequency))
      : DEFAULT_CONFIG.poll_frequency,
    // The preference is a boolean; anything but an explicit false means true.
    GLADYS_PREFER_LOCAL: raw.GLADYS_PREFER_LOCAL !== false,
    [REFRESH_TOKEN_KEY]: text(raw[REFRESH_TOKEN_KEY], DEFAULT_CONFIG[REFRESH_TOKEN_KEY]),
  };
}
