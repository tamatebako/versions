import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mib, relAge, envName, badge } from './format.ts';
import { validate } from '../../tools/lib/validate.ts';
import type { VersionsData } from './types.ts';

const NOW = new Date('2026-09-09T00:00:00.000Z');

test('format helpers', () => {
  assert.strictEqual(mib(3_145_728), '3.0');
  assert.strictEqual(relAge('2026-09-08T23:30:00.000Z', NOW), 'just now');
  assert.strictEqual(relAge('2026-09-08T20:00:00.000Z', NOW), '4 h ago');
  assert.strictEqual(relAge('2026-09-08T00:00:00.000Z', NOW), '1 day ago');
  assert.strictEqual(envName('metanorma-tr'), 'TEBAKO_METANORMA_TR_VERSION');
  assert.ok(badge('tebako toolchain', '2.5.0').includes('tebako%20toolchain-2.5.0-blue'));
});

const good: VersionsData = {
  generated_at: NOW.toISOString(),
  sources: [{ url: 'fixture://x', kind: 'registry', ok: true }],
  runtimes: [
    {
      engine: 'ruby',
      lang_version: '3.3.12',
      flavor: null,
      tebako_line: '0.16.22',
      triplet: 'macos-arm64',
      reference: 'ruby@3.3.12;tebako=0.16.22;image',
      latest_in_line: true,
      capabilities: null,
      exe: { url: 'https://x/y', size: 1, downloads: 2, sha256: null },
      image: null,
      release: { tag: 'v0.16.22', url: 'https://x', published_at: NOW.toISOString(), prerelease: false },
    },
  ],
  payloads: [
    {
      name: 'hello',
      kind: 'toolkit',
      summary: null,
      registry_repo: 'tebako-packages/hello',
      registry_url: 'https://x',
      versions: [
        {
          version: '2.12',
          entrypoints: ['hello'],
          runtime_requirement: null,
          platforms: [{ platform: 'x86_64-linux-gnu', artifact: 'hello.tfs', sha256: '0'.repeat(64) }],
          artifact_url: null,
          sha256: '0'.repeat(64),
        },
      ],
    },
  ],
  toolchain: [{ version: '2.5.0', url: 'https://x', published_at: NOW.toISOString(), bootstrap: [{ triplet: 'macos-arm64', bytes: 1_554_816 }] }],
};

test('validate accepts schema-shaped data', () => {
  validate(good);
});

test('validate rejects drift loudly (named failures, never silent)', () => {
  const bad = structuredClone(good);
  bad.runtimes[0].capabilities = [42 as unknown as string];
  assert.throws(() => validate(bad), /capabilities/);
  const bad2 = structuredClone(good);
  bad2.payloads[0].versions[0].platforms[0].sha256 = 7 as unknown as string;
  assert.throws(() => validate(bad2), /platform/);
});
