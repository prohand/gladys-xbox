// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MANIFEST_ACTIONS } from '../src/app.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { BUTTONS } from '../src/xbox/cloud.js';
import { SCENE_TRIGGERS } from '../src/xbox/service.js';
import { SMARTGLASS_PORT } from '../src/xbox/smartglass.js';
import { WAKE_WAIT_MAX_SECONDS } from '../src/scenes.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const CAPABILITY_FIELDS = ['scene_triggers', 'scene_actions', 'widgets'];
const CAPABILITY_MIN_GLADYS_VERSION = [5, 1, 0];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// Minimum version of the manifest `gladys_version` range, e.g. [5, 1, 0].
function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

// Every multi-language text of the manifest, with its path.
function* texts(node, path = 'manifest') {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) yield* texts(item, `${path}[${index}]`);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (['label', 'description', 'placeholder'].includes(key)) {
        yield { path: `${path}.${key}`, value };
      } else {
        yield* texts(value, `${path}.${key}`);
      }
    }
  }
}

test('every manifest action has a registered handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(MANIFEST_ACTIONS).sort());
});

test('declaring scene triggers, scene actions or widgets requires Gladys >= 5.1.0', () => {
  const declared = CAPABILITY_FIELDS.filter((field) => manifest[field] !== undefined);
  assert.equal(
    declared.length,
    CAPABILITY_FIELDS.length,
    'widgets, triggers and scenes are declared',
  );
  assert.ok(
    isAtLeast(minGladysVersion(), CAPABILITY_MIN_GLADYS_VERSION),
    `${declared.join(', ')} requires gladys_version >= 5.1.0, got "${manifest.gladys_version}"`,
  );
});

test('the catalog categories are 1 to 3 keys', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
});

test('both transports are declared: local (SmartGlass) and cloud (Xbox Live)', () => {
  assert.deepEqual([...manifest.transports].sort(), ['cloud', 'local']);
});

test('the LAN discovery is declared on the SmartGlass port', () => {
  assert.deepEqual(manifest.network_discovery, [
    { type: 'udp-active-broadcast', ports: [SMARTGLASS_PORT] },
  ]);
});

test('every scene_actions key has an onSceneAction handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every widgets key has an onWidgetGet handler, and vice versa', () => {
  const declared = keysOf(manifest.widgets);
  for (const key of declared) {
    assert.equal(typeof WIDGETS[key]?.get, 'function', `widget "${key}" has no content handler`);
  }
  assert.deepEqual(declared.sort(), Object.keys(WIDGETS).sort());
});

test('every scene trigger the code fires is declared in scene_triggers, and vice versa', () => {
  // An undeclared key is a 404 on publishSceneEvent; a declared key nobody
  // fires is a dead card in the scene editor.
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(SCENE_TRIGGERS).sort());
});

test('the press_button options are the buttons the console accepts', () => {
  const action = manifest.scene_actions.find((a) => a.key === 'press_button');
  const field = action.fields.find((f) => f.key === 'button');
  assert.deepEqual(
    field.options.map((o) => o.value),
    BUTTONS,
  );
});

test('the wake_console wait fits in the action timeout', () => {
  const action = manifest.scene_actions.find((a) => a.key === 'wake_console');
  const field = action.fields.find((f) => f.key === 'wait_seconds');
  assert.equal(field.max, WAKE_WAIT_MAX_SECONDS);
  assert.ok(field.max < action.timeout_seconds, 'the console check needs some margin');
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(section.placeholder, undefined, `section "${section.key}" has no placeholder`);
    assert.ok(!(section.key in DEFAULT_CONFIG), `section "${section.key}" stores no value`);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('the Microsoft account is an oauth2 field, and its token is stored off-schema', () => {
  const oauth = manifest.config_schema.filter((f) => f.type === 'oauth2');
  assert.deepEqual(keysOf(oauth), ['microsoft_account']);
  assert.ok(!keysOf(manifest.config_schema).includes('oauth_refresh_token'));
  const secret = manifest.config_schema.find((f) => f.key === 'client_secret');
  assert.equal(secret.type, 'secret', 'the client secret is never sent back to the browser');
});

test('dynamic selects declare a source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}": source and options together`);
    assert.equal(field.default, undefined, `field "${field.key}": no default with a source`);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  // The Release workflow writes all three: a mismatch means one was edited by
  // hand, and Gladys would offer a version whose image is another one.
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('every text is a multi-language object, in English and French', () => {
  for (const { path, value } of texts(manifest)) {
    assert.equal(typeof value, 'object', `${path} must be a multi-language object`);
    assert.ok(value.en, `${path} needs an English text`);
    assert.ok(value.fr, `${path} needs a French text`);
  }
});
