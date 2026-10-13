# Gladys Xbox

External integration for [Gladys Assistant](https://gladysassistant.com) that
controls **Xbox consoles** (Xbox One, Xbox Series X|S), built from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js)
with the SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

User documentation: [English](docs/en.md) · [Français](docs/fr.md) · [Deutsch](docs/de.md) ·
[Español](docs/es.md).

## Features

| Surface          | What                                                                                           | Channel       |
| ---------------- | ---------------------------------------------------------------------------------------------- | ------------- |
| Discovery        | consoles found on the LAN (broadcast relayed by Gladys, or typed addresses) and in the account | local / cloud |
| Device           | power (on: local or cloud, off: cloud), mute, volume, media keys, controller keys              | local / cloud |
| Device           | game being played (read-only text feature)                                                     | cloud         |
| Scene triggers   | `title_started`, `title_stopped` (with `played_minutes`)                                       | cloud         |
| Scene actions    | `wake_console` (output `awake`), `launch_game` (`launched`), `press_button` (`pressed`)        | local / cloud |
| Dashboard widget | `xbox_console`: power, game, connection, account, quick buttons                                | local / cloud |
| Config action    | `test_connection`: tests both channels and searches for consoles                               | local / cloud |

The manifest declares `"transports": ["local", "cloud"]`: Gladys shows the
standard **Prefer the local connection** toggle (`GLADYS_PREFER_LOCAL`), and
each console publishes its effective transport badge (`local`, `cloud`,
`unreachable`, degraded when the cloud serves a console the LAN discovery did
not find).

### How it talks to the console

- **Local — SmartGlass over UDP 5050.** Only the unencrypted packets: the
  discovery (`0xDD00` → `0xDD01`, the Live ID is the CN of the console
  certificate) and the power on (`0xDD02`). The broadcast goes through the core
  (`scanNetwork('udp-active-broadcast')`, manifest `network_discovery`): the
  integration container sits on a bridge network that broadcasts never cross.
  Pings and power on are plain unicast.
- **Cloud — Xbox Live.** Microsoft OAuth2 (the oauth2 config field, relayed by
  Gladys) → Xbox user token → XSTS token; then the console control service
  (`xccs.xboxlive.com`: consoles, power state, commands) and the presence
  service (`userpresence.xboxlive.com`: the game being played). Only the
  Microsoft refresh token is stored, in the off-schema config key
  `oauth_refresh_token`.

## Project structure

```
.
├─ index.js                          # SDK bootstrap (no Xbox logic)
├─ src/
│  ├─ app.js                         # SDK handlers wired to the service
│  ├─ config.js                      # config defaults + normalization
│  ├─ scenes.js                      # scene actions (Gladys 5.1+)
│  ├─ widgets.js                     # dashboard widget (Gladys 5.1+)
│  ├─ devices/
│  │  ├─ index.js                    # poll pacing
│  │  └─ console.js                  # the console device: features, params, ids
│  └─ xbox/
│     ├─ service.js                  # the consoles, channel choice, states, events
│     ├─ smartglass.js               # SmartGlass packets (build / parse)
│     ├─ local.js                    # UDP transport + local channel
│     ├─ auth.js                     # Microsoft + Xbox Live tokens
│     └─ cloud.js                    # console control + presence services
├─ docs/{en,fr,de,es}.md            # user documentation (re-hosted by Gladys)
├─ test/                             # node --test, fake Gladys + fake network
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md                      # Keep a Changelog, rolled by the Release workflow
├─ CLAUDE.md                         # project rules for contributors & coding assistants
├─ SECURITY.md                       # how to report a vulnerability privately
└─ .github/                          # CI, build, release, GitHub releases, Dependabot
```

## Development

```bash
npm install
npm test               # node --test (no network: fake Gladys, fake UDP, fake fetch)
npm run lint           # ESLint
npm run format:check   # Prettier, as the CI runs it
npm run format         # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run it against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="xbox" \
LOG_LEVEL=debug \
npm start
```

## CI and releases

Same workflows as [gladys-devmel](https://github.com/prohand/gladys-devmel):

- `ci.yml` — Prettier, ESLint and tests on Node 22 and 24 on every push to
  `main` and every pull request; on pull requests also the store admission
  checks and a Docker build (amd64, not pushed).
- `release.yml` — **Actions → Release → Run workflow** (patch / minor / major):
  bumps `package.json` and the manifest (`version` + `docker_image`), moves the
  `## [Unreleased]` section of `CHANGELOG.md` under the version, tags `vX.Y.Z`,
  builds the image and publishes the GitHub Release.
- `build.yml` — multi-arch image (`linux/amd64` + `linux/arm64`) to
  `ghcr.io/prohand/gladys-xbox`, on a version tag, a manual run or called by
  the release.
- `github-release.yml` — a GitHub Release for every `vX.Y.Z` tag (the Gladys
  Supervision page links each version to it).
- `dependabot.yml` — npm weekly, GitHub Actions and Docker base image monthly.

## Publish

1. Add the GitHub topic `gladys-assistant-integration` to the repository, and
   make the `ghcr.io` package public after the first build.
2. Describe the changes under `## [Unreleased]` in `CHANGELOG.md`.
3. **Actions → Release → Run workflow**.
4. The store indexer picks up the new manifest `version`.

Turn on **Private vulnerability reporting** in the repository security
settings: [`SECURITY.md`](SECURITY.md) sends reporters there.

Xbox is a trademark of Microsoft. This project is not affiliated with Microsoft.

## License

Apache-2.0
