import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const REPO = 'https://github.com/prohand/gladys-xbox';

test('the Unreleased section moves under the released version', () => {
  const before = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Xbox.\n\n[Unreleased]: ${REPO}/commits/main\n`;
  const after = rollChangelog(before, '1.0.0', '2026-10-13');
  assert.equal(
    after,
    `# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-10-13\n\n### Added\n\n- Xbox.\n\n` +
      `[Unreleased]: ${REPO}/compare/v1.0.0...HEAD\n[1.0.0]: ${REPO}/releases/tag/v1.0.0\n`,
  );
});

test('the changelog of the repository can be rolled', async () => {
  const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.ok(changelog.includes('## [Unreleased]'));
  assert.match(changelog, /^\[Unreleased\]: \S+\/commits\/main$/m);
  assert.notEqual(rollChangelog(changelog, '9.9.9', '2026-10-13'), changelog);
});
