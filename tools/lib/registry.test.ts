import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShaSums, mapRegistry, harvestCatalogInfo, mergeCatalogInfo } from './registry.ts';

test('parseShaSums: text and binary line shapes', () => {
  const map = parseShaSums(
    `${'a'.repeat(64)}  tebako-runtime-0.16.22-3.3.12-macos-arm64\n` +
      `${'b'.repeat(64)} *tebako-runtime-0.16.22-3.3.12-macos-arm64.tfs\n` +
      `not-a-sum-line\n`,
  );
  assert.strictEqual(map.size, 2);
  assert.strictEqual(map.get('tebako-runtime-0.16.22-3.3.12-macos-arm64'), 'a'.repeat(64));
  assert.strictEqual(map.get('tebako-runtime-0.16.22-3.3.12-macos-arm64.tfs'), 'b'.repeat(64));
});

// The real xml2rfc registry shape (tebako-packages/xml2rfc, 2026-09-08).
const xml2rfcRegistry = {
  schema_version: 1,
  payloads: [
    {
      name: 'xml2rfc',
      kind: 'app',
      versions: [
        {
          version: '3.34.0',
          platforms: {
            'x86_64-macos': {
              artifact: 'xml2rfc-3.34.0-macos-x86_64.tfs',
              sha256: '6e8ec87e57fa4627ae666e9961cb1d09a7bdf5246b77512505054d3c588a6664',
            },
            'aarch64-macos': {
              artifact: 'xml2rfc-3.34.0-macos-arm64.tfs',
              sha256: 'dd4e43954ed00af526ca52ba8e8470b7f83505817acad087b919d4a3de2fd0a7',
            },
          },
          release: { ref: 'tfs:github:tebako-packages/xml2rfc:3.34.0' },
          runtime_requirement: { engine: 'python', constraint: '~> 3.13.0', abi: 'cpython-313' },
          entrypoints: ['xml2rfc'],
          unknown_future_key: { ignored: true },
        },
      ],
      default: '3.34.0',
    },
  ],
};

test('mapRegistry: real feedstock shape → PayloadRow (defensive)', () => {
  const rows = mapRegistry(xml2rfcRegistry, 'tebako-packages/xml2rfc', 'https://x');
  assert.strictEqual(rows.length, 1);
  const r = rows[0];
  assert.strictEqual(r.kind, 'app');
  assert.strictEqual(r.versions.length, 1);
  const ver = r.versions[0];
  assert.strictEqual(ver.version, '3.34.0');
  assert.deepStrictEqual(ver.entrypoints, ['xml2rfc']);
  assert.strictEqual(ver.runtime_requirement, 'python ~> 3.13.0');
  assert.deepStrictEqual(ver.platforms, [
    { platform: 'aarch64-macos', artifact: 'xml2rfc-3.34.0-macos-arm64.tfs', sha256: 'dd4e43954ed00af526ca52ba8e8470b7f83505817acad087b919d4a3de2fd0a7' },
    { platform: 'x86_64-macos', artifact: 'xml2rfc-3.34.0-macos-x86_64.tfs', sha256: '6e8ec87e57fa4627ae666e9961cb1d09a7bdf5246b77512505054d3c588a6664' },
  ]);
  // never guessed: no absolute URLs in the registry, ambiguous sha across platforms
  assert.strictEqual(ver.artifact_url, null);
  assert.strictEqual(ver.sha256, null);
});

test('mapRegistry: single-platform version carries its sha; junk shapes yield empties, not crashes', () => {
  const rows = mapRegistry(
    {
      payloads: [
        {
          name: 'solo',
          versions: [
            { version: 1, platforms: { p1: { artifact: 'a.tfs', sha256: '0'.repeat(64) } } },
            'garbage-version-entry',
          ],
        },
        { noversion: true },
        'not-a-payload',
      ],
    },
    'r',
    'u',
  );
  assert.strictEqual(rows.length, 1);
  const ver = rows[0].versions[0];
  assert.strictEqual(ver.version, '1');
  assert.strictEqual(ver.sha256, '0'.repeat(64));
  assert.strictEqual(rows[0].versions.length, 2);
  assert.strictEqual(rows[0].kind, null);
  assert.strictEqual(rows[0].summary, null);
});

test('mapRegistry: non-payload registries (pointer/catalog shapes) map to nothing', () => {
  assert.deepStrictEqual(mapRegistry({ packages: [{ name: 'x', kind: 'toolkit' }] }, 'r', 'u'), []);
  assert.deepStrictEqual(mapRegistry(null, 'r', 'u'), []);
});

// The real index catalog shape (tebako-packages/index, 2026-09-08).
const indexCatalog = {
  schema_version: 1,
  packages: [
    { name: 'inkscape', kind: 'toolkit', summary: 'Vector graphics editor (CLI tools) — metanorma’s graphics chain' },
    { name: 'hello', kind: 'toolkit', summary: 'GNU hello — template prover payload for tebako-packages' },
  ],
};

test('harvest + merge: the catalog fills gaps without overriding feedstock truth', () => {
  const harvested = harvestCatalogInfo(indexCatalog);
  assert.strictEqual(harvested.get('hello')?.kind, 'toolkit');
  assert.deepStrictEqual([...harvestCatalogInfo({ payloads: [] }).entries()], []);

  const rows = mapRegistry(
    { payloads: [{ name: 'hello', versions: [] }, { name: 'inkscape', kind: 'toolkit', summary: 'own', versions: [] }] },
    'r',
    'u',
  );
  mergeCatalogInfo(rows, harvested);
  assert.strictEqual(rows[0].summary, 'GNU hello — template prover payload for tebako-packages');
  assert.strictEqual(rows[1].summary, 'own'); // feedstock truth wins
});
