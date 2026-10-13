# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human contributors
working in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for **Xbox consoles** (Xbox One, Series X|S).
It started from the official template `GladysAssistant/integration-template-js`; its CI and
release workflows are the ones of `prohand/gladys-devmel`.

Two channels, one device per console keyed on its **Live ID**:

- **local** — SmartGlass over UDP 5050, unencrypted packets only: discovery (who is on) and
  power on. Needs no account.
- **cloud** — Xbox Live with the user's Microsoft account (oauth2 config field): power off,
  volume, mute, media and controller keys, launching a game, the game being played.

Gladys 5.1+ capabilities: scene triggers (`title_started`, `title_stopped`), scene actions
(`wake_console`, `launch_game`, `press_button`) and the `xbox_console` widget.

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/app.test.js                # one file
node --test --test-name-pattern "power on"  # tests whose name matches
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI runs `format:check`, `lint`, `test` on Node 22 and 24 (plus the store checks and a Docker
build on pull requests): run the three commands before pushing. Releases: **Actions → Release**
only (bumps `package.json`, manifest `version` + `docker_image`, rolls `CHANGELOG.md`, re-runs
Prettier, tags, builds, publishes the GitHub Release).

## Architecture

```
index.js                SDK bootstrap only
src/app.js              SDK handlers → service (testable with the fake Gladys)
src/config.js           DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/devices/console.js  the console device: features (television + text), params, external ids
src/devices/index.js    poll pacing (createPoller)
src/xbox/service.js     consoles map, channel choice, states, transport badges, scene events
src/xbox/smartglass.js  SmartGlass packets: discovery request/response, power on
src/xbox/local.js       UDP transport (injectable) + local channel (ping, power on, discover)
src/xbox/auth.js        Microsoft OAuth2 → Xbox user token → XSTS token
src/xbox/cloud.js       xccs.xboxlive.com (consoles, commands) + userpresence (game played)
src/scenes.js           scene action handlers (manifest `scene_actions`)
src/widgets.js          widget handlers (manifest `widgets`)
```

### Invariants worth knowing

- **External ids are forever.** A console is `gladys.externalIds('xbox', liveId.toLowerCase())`;
  feature keys (`power`, `volume-up`, `title`…), trigger, action, widget and config keys are
  stored by users: never rename one.
- **The same console seen on the LAN and in the account is ONE device**: both give its Live ID
  (LAN: the CN of the certificate of the discovery response; cloud: the console `id`).
- **Broadcasts never leave the bridge container**: the LAN discovery goes through the core
  (`scanNetwork('udp-active-broadcast')` on port 5050, declared in `network_discovery`); pings
  and power on are unicast. The core admits one active scan per 10 s.
- **Known addresses survive restarts in the device params** (`IP_ADDRESS`, `LIVE_ID`,
  `CONSOLE_TYPE`), re-read from `gladys.devices` at every connection.
- **Turning a console off needs the encrypted SmartGlass session**, which is not implemented:
  off, volume and keys are cloud only, and say so (`CloudRequiredError`) without it.
- **Channel choice** follows `GLADYS_PREFER_LOCAL` for the state read and the power on; the
  badge says which channel served the console last.
- **Polling**: devices declare `should_poll: true` + `poll_frequency` 30 000 ms (an enum in
  ms; any other value rejects the whole discovery batch). The configured `poll_frequency` is
  in seconds and applied by skipping polls.
- **Scene events fire on transitions only** (a game starts / stops), never on the first
  observation after a restart, never as a consequence of a received action.
- **Secrets**: only the Microsoft refresh token is stored, in the off-schema config key
  `oauth_refresh_token`; `client_secret` is a `secret` field. Never log a token or a secret.
- **The container rootfs is read-only**: write only under `/data` (nothing is written today).

## Rules

- **Versions belong to the Release workflow.** Never edit `version` in `package.json` or in
  the manifest, nor the `docker_image` tag, by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a
  version heading: the Release workflow moves the section.
- **Manifest.** Every text is `{ "en": ..., "fr": ... }` (label, description, placeholder);
  the catalog description holds 10 to 100 characters per language; `widgets`,
  `scene_triggers`, `scene_actions` need `gladys_version >= 5.1.0`. `test/manifest.test.js`
  ties the manifest to the code: change both sides together.
- **User-facing text** is bilingual (English and French): action messages, manifest texts,
  `docs/en.md` / `docs/fr.md`, kept in sync.
- **Tests never touch the network**: `test/helpers/fakeXbox.js` fakes the UDP transport and
  Xbox Live, `test/helpers/start.js` runs the app against `createFakeGladys()` of the SDK.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in English.
