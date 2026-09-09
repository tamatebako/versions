import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineViews } from './groups.ts';
import type { VersionsData } from './types.ts';

const row = (over: Partial<VersionsData['runtimes'][number]>): VersionsData['runtimes'][number] => ({
  engine: 'ruby',
  lang_version: '3.3.12',
  flavor: null,
  tebako_line: '0.16.22',
  triplet: 'macos-arm64',
  reference: 'ruby@3.3.12;tebako=0.16.22;image',
  latest_in_line: true,
  capabilities: null,
  exe: null,
  image: null,
  release: { tag: 'v0.16.22', url: 'https://example.com/v0.16.22', published_at: '2026-09-05T22:21:52Z', prerelease: false },
  ...over,
});

const data: VersionsData = {
  generated_at: '2026-09-09T00:00:00.000Z',
  sources: [],
  runtimes: [
    row({}),
    row({ triplet: 'linux-gnu-x86_64' }),
    row({ tebako_line: '0.16.21', latest_in_line: false, reference: 'ruby@3.3.12;tebako=0.16.21;image' }),
    row({ engine: 'python', lang_version: '3.13.15', flavor: 'jit', tebako_line: '0.1.2', triplet: 'macos-arm64' }),
  ],
  payloads: [],
  toolchain: [],
};

test('lines group by engine+lang+flavor, releases newest first, latest flagged', () => {
  const views = lineViews(data);
  assert.strictEqual(views.length, 2);
  const ruby = views.find((v) => v.engine === 'ruby')!;
  assert.strictEqual(ruby.releaseCount, 2);
  assert.strictEqual(ruby.latestTebako, '0.16.22');
  assert.strictEqual(ruby.groups[0].isLatest, true);
  assert.strictEqual(ruby.groups[0].rows.length, 2);
  assert.strictEqual(ruby.groups[1].tebakoLine, '0.16.21');
  assert.strictEqual(ruby.groups[1].isLatest, false);
});

test('flavored lines are distinct lines and slug distinctly', () => {
  const jit = lineViews(data).find((v) => v.engine === 'python')!;
  assert.strictEqual(jit.flavor, 'jit');
  assert.strictEqual(jit.slug, 'python-3.13.15-jit');
});
