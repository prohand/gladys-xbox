# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.1.1] - 2026-10-23

- Maintenance release, no functional change.

## [1.1.0] - 2026-10-13

### Added

- German and Spanish translations (configuration screen, messages, widgets,
  documentation).

### Fixed

- The English documentation names the Gladys screens as the Gladys interface does.

## [1.0.2] - 2026-10-13

- Maintenance release, no functional change.

## [1.0.1] - 2026-10-13

### Added

- Xbox consoles in Gladys, one device per console, keyed on its Live ID.
- Local channel (SmartGlass, UDP 5050), no account needed: the consoles are
  found on the network (broadcast relayed by Gladys, or addresses typed by
  hand), their power state is read, and they are turned on.
- Cloud channel (Xbox Live, optional): link a Microsoft account with the
  Connect button to also turn the consoles off, mute them, change the volume,
  use the media keys and the controller buttons, and see the game being played.
- The "Prefer the local connection" toggle picks the channel asked first; the
  transport badge of each console says which one served it, and flags a console
  the LAN discovery could not find.
- Scene triggers: a game starts, a game stops (with the minutes played).
- Scene actions: turn a console on and wait until it answers, launch a game by
  its Store product ID, press a controller button.
- An "Xbox console" dashboard widget: power, game being played, connection,
  account, and quick buttons (turn on/off, home, play/pause).
- "Test the connection and search for consoles" button in the configuration.
- User documentation in English and French.
- CI (format, lint, tests on Node 22 and 24, store checks and Docker build on
  pull requests), UI-driven releases, GitHub Releases, Dependabot.

[Unreleased]: https://github.com/prohand/gladys-xbox/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/prohand/gladys-xbox/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/prohand/gladys-xbox/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/prohand/gladys-xbox/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/prohand/gladys-xbox/releases/tag/v1.0.1
