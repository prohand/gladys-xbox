// -----------------------------------------------------------------------------
// Device type: XBOX CONSOLE
//
// One Gladys device per console, keyed on its Live ID (the identifier the
// console carries in its certificate, and the one Xbox Live uses too): the
// same console found on the LAN and in the Microsoft account is ONE device.
//
// The features are the standard `television` ones, so the Gladys TV widget and
// the "device state" scenes work out of the box, plus a read-only `text`
// feature holding the game being played.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { COMMANDS, buttonCommand } from '../xbox/cloud.js';

export const DEVICE_TYPE = 'xbox';

const TV = DEVICE_FEATURE_TYPES.TELEVISION;

// Feature keys are part of the external ids: never rename one.
export const FEATURES = {
  POWER: 'power',
  VOLUME_UP: 'volume-up',
  VOLUME_DOWN: 'volume-down',
  VOLUME_MUTE: 'volume-mute',
  PLAY: 'play',
  PAUSE: 'pause',
  PREVIOUS: 'previous',
  NEXT: 'next',
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
  ENTER: 'enter',
  RETURN: 'return',
  MENU: 'menu',
  GUIDE: 'guide',
  INFO: 'info',
  TITLE: 'title',
};

// The keys of a remote: push buttons, each one a cloud command. They hold no
// state, so nothing is published back for them.
export const BUTTON_FEATURES = {
  [FEATURES.VOLUME_UP]: { name: 'Volume up', type: TV.VOLUME_UP, command: COMMANDS.VOLUME_UP },
  [FEATURES.VOLUME_DOWN]: {
    name: 'Volume down',
    type: TV.VOLUME_DOWN,
    command: COMMANDS.VOLUME_DOWN,
  },
  [FEATURES.PLAY]: { name: 'Play', type: TV.PLAY, command: COMMANDS.PLAY },
  [FEATURES.PAUSE]: { name: 'Pause', type: TV.PAUSE, command: COMMANDS.PAUSE },
  [FEATURES.PREVIOUS]: { name: 'Previous', type: TV.PREVIOUS, command: COMMANDS.PREVIOUS },
  [FEATURES.NEXT]: { name: 'Next', type: TV.NEXT, command: COMMANDS.NEXT },
  [FEATURES.UP]: { name: 'Up', type: TV.UP, command: buttonCommand('Up') },
  [FEATURES.DOWN]: { name: 'Down', type: TV.DOWN, command: buttonCommand('Down') },
  [FEATURES.LEFT]: { name: 'Left', type: TV.LEFT, command: buttonCommand('Left') },
  [FEATURES.RIGHT]: { name: 'Right', type: TV.RIGHT, command: buttonCommand('Right') },
  [FEATURES.ENTER]: { name: 'A (select)', type: TV.ENTER, command: buttonCommand('A') },
  [FEATURES.RETURN]: { name: 'B (back)', type: TV.RETURN, command: buttonCommand('B') },
  [FEATURES.MENU]: { name: 'Menu', type: TV.MENU, command: buttonCommand('Menu') },
  [FEATURES.GUIDE]: {
    name: 'Xbox button (guide)',
    type: TV.GUIDE,
    command: buttonCommand('Nexus'),
  },
  [FEATURES.INFO]: { name: 'View', type: TV.INFO, command: buttonCommand('View') },
};

// Device params: what the integration needs to reach the console again after
// a restart, re-published (upserted) at every discovery.
export const PARAMS = {
  LIVE_ID: 'LIVE_ID',
  IP_ADDRESS: 'IP_ADDRESS',
  CONSOLE_TYPE: 'CONSOLE_TYPE',
};

// Shown when no game runs: a text state cannot be empty.
export const NO_TITLE = '-';

export function consoleIds(gladys, liveId) {
  return gladys.externalIds(DEVICE_TYPE, liveId.toLowerCase());
}

/**
 * Live ID of a device external id, or null when it is not a console of this
 * integration.
 */
export function liveIdFromExternalId(gladys, externalId) {
  const prefix = gladys.externalId(`${DEVICE_TYPE}:`);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const [platformId] = externalId.slice(prefix.length).split(':');
  return platformId ? platformId.toUpperCase() : null;
}

/**
 * Key of a feature, from its external id.
 */
export function featureKey(featureExternalId) {
  return featureExternalId.split(':').pop();
}

function feature(ids, key, name, type, extra = {}) {
  return {
    name,
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.TELEVISION,
    type,
    read_only: false,
    has_feedback: false,
    keep_history: false,
    min: 0,
    max: 1,
    ...extra,
  };
}

/**
 * Discovery payload of one console.
 * @param {object} gladys
 * @param {{ liveId: string, name?: string, consoleType?: string, address?: string | null }} console
 */
export function buildConsoleDevice(gladys, console) {
  const ids = consoleIds(gladys, console.liveId);
  const params = [
    { name: PARAMS.LIVE_ID, value: console.liveId },
    { name: PARAMS.CONSOLE_TYPE, value: console.consoleType || 'Xbox' },
  ];
  if (console.address) {
    params.push({ name: PARAMS.IP_ADDRESS, value: console.address });
  }
  return {
    name: console.name || 'Xbox',
    external_id: ids.device,
    model: console.consoleType || 'Xbox',
    // Gladys polls every 30 s at most; the configured refresh interval is
    // applied by skipping polls (see createPoller).
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_30_SECONDS,
    params,
    features: [
      feature(ids, FEATURES.POWER, 'Power', TV.BINARY, { has_feedback: true, keep_history: true }),
      feature(ids, FEATURES.VOLUME_MUTE, 'Mute', TV.VOLUME_MUTE),
      ...Object.entries(BUTTON_FEATURES).map(([key, button]) =>
        feature(ids, key, button.name, button.type),
      ),
      {
        name: 'Game being played',
        external_id: ids.feature(FEATURES.TITLE),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
        read_only: true,
        has_feedback: false,
        keep_history: true,
        min: 0,
        max: 0,
      },
    ],
  };
}

/**
 * Read a console back from a device created in Gladys (its params).
 * @returns {{ liveId: string, name: string, consoleType: string, address: string | null } | null}
 */
export function consoleFromDevice(gladys, device) {
  const liveId = liveIdFromExternalId(gladys, device.external_id);
  if (!liveId) {
    return null;
  }
  const param = (name) => (device.params ?? []).find((p) => p.name === name)?.value || null;
  return {
    liveId,
    name: device.name,
    consoleType: param(PARAMS.CONSOLE_TYPE) || 'Xbox',
    address: param(PARAMS.IP_ADDRESS),
  };
}
