import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linePath, payloadPath, sitemapPaths, runtimeRequirementTarget } from './paths.ts';
import type { VersionsData } from './types.ts';

const data: VersionsData = {
  generated_at: '2026-09-09T00:00:00.000Z',
  sources: [],
  runtimes: [
    {
      engine: 'ruby', lang_version: '3.3.12', flavor: null, tebako_line: '0.16.22', triplet: 'macos-arm64',
      reference: 'r', latest_in_line: true, capabilities: null, exe: null, image: null,
      release: { tag: 'v', url: 'u', published_at: '2026-09-05T22:21:52Z', prerelease: false, signed: false },
    },
    {
      engine: 'python', lang_version: '3.13.15', flavor: 'jit', tebako_line: '0.1.2', triplet: 'macos-arm64',
      reference: 'p', latest_in_line: true, capabilities: null, exe: null, image: null,
      release: { tag: 'v', url: 'u', published_at: '2026-09-08T12:47:40Z', prerelease: false, signed: false },
    },
  ],
  payloads: [
    { name: 'hello', kind: 'toolkit', summary: null, registry_repo: 'r', registry_url: 'u', versions: [] },
  ],
  toolchain: [],
};

test('route URL spelling lives here', () => {
  assert.strictEqual(linePath('ruby', '3.3.12', null), '/versions/runtime/ruby-3.3.12/');
  assert.strictEqual(linePath('python', '3.13.15', 'jit'), '/versions/runtime/python-3.13.15-jit/');
  assert.strictEqual(payloadPath('hello'), '/versions/payload/hello/');
});

test('sitemapPaths covers every addressable page exactly once', () => {
  assert.deepStrictEqual(sitemapPaths(data), [
    '/versions/',
    '/versions/runtime/python-3.13.15-jit/',
    '/versions/runtime/ruby-3.3.12/',
    '/versions/payload/hello/',
  ]);
});

test('runtime requirements resolve to the highest matching line', () => {
  assert.deepStrictEqual(runtimeRequirementTarget('ruby ~> 3.3.0', data), { engine: 'ruby', lang: '3.3.12', flavor: null });
  assert.strictEqual(runtimeRequirementTarget('python ~> 3.13.0', data)?.flavor, 'jit'); // only the jit line exists in this fixture
  assert.strictEqual(runtimeRequirementTarget('ruby ~> 9.9.0', data), null);
  assert.strictEqual(runtimeRequirementTarget('anything', data), null);
});
