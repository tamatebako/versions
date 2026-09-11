import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRuntimeAsset, parseBootstrapAsset, deriveTriplets } from './grammar.ts';

const TRIPLETS = [
  'macos-arm64',
  'macos-x86_64',
  'linux-gnu-x86_64',
  'linux-gnu-arm64',
  'linux-musl-x86_64',
  'linux-musl-arm64',
  'windows-ucrt64',
];

test('bare POSIX name parses as the interpreter exe', () => {
  const p = parseRuntimeAsset('tebako-runtime-0.16.22-3.3.12-macos-arm64', TRIPLETS);
  assert.deepStrictEqual(p, {
    tebakoVer: '0.16.22',
    langVer: '3.3.12',
    flavor: null,
    triplet: 'macos-arm64',
    kind: 'exe',
  });
});

test('hyphenated triplets match as units, not greedy splits', () => {
  for (const t of ['linux-gnu-x86_64', 'linux-musl-arm64', 'windows-ucrt64']) {
    const p = parseRuntimeAsset(`tebako-runtime-0.1.2-3.11.16-${t}`, TRIPLETS);
    assert.strictEqual(p?.triplet, t);
  }
});

test('suffixes: exe, tfs image, manifest, sha256 sidecar, dll', () => {
  const stem = 'tebako-runtime-0.16.22-3.1.6-windows-ucrt64';
  assert.strictEqual(parseRuntimeAsset(stem, TRIPLETS)?.kind, 'exe');
  assert.strictEqual(parseRuntimeAsset(`${stem}.tfs`, TRIPLETS)?.kind, 'image');
  assert.strictEqual(parseRuntimeAsset(`${stem}.manifest.json`, TRIPLETS)?.kind, 'manifest');
  assert.strictEqual(parseRuntimeAsset(`${stem}.sha256`, TRIPLETS)?.kind, 'sidecar');
  assert.strictEqual(parseRuntimeAsset(`${stem}.tfs.sha256`, TRIPLETS)?.kind, 'sidecar');
  assert.strictEqual(parseRuntimeAsset(`${stem}.asc`, TRIPLETS)?.kind, 'sidecar');
  assert.strictEqual(parseRuntimeAsset(`${stem}.tfs.asc`, TRIPLETS)?.kind, 'sidecar');
  assert.strictEqual(parseRuntimeAsset(`${stem}.exe.asc`, TRIPLETS)?.kind, 'sidecar');
  assert.strictEqual(parseRuntimeAsset(`${stem}.asc`, TRIPLETS)?.kind, 'sidecar');
  assert.strictEqual(parseRuntimeAsset(`${stem}.dll`, TRIPLETS)?.kind, 'dll');
});

test('langVer flavor suffix is exposed as the flavor', () => {
  const p = parseRuntimeAsset('tebako-runtime-0.1.2-3.13.15-jit-linux-gnu-arm64', TRIPLETS);
  assert.strictEqual(p?.langVer, '3.13.15');
  assert.strictEqual(p?.flavor, 'jit');
  assert.strictEqual(p?.triplet, 'linux-gnu-arm64');
});

test('non-runtime assets and unknown triplets are rejected', () => {
  assert.strictEqual(parseRuntimeAsset('SHA256SUMS.txt', TRIPLETS), null);
  assert.strictEqual(parseRuntimeAsset('manifest.json', TRIPLETS), null);
  assert.strictEqual(parseRuntimeAsset('tebako-runtime-0.16.22-3.3.12-plan9-arm', TRIPLETS), null);
  assert.strictEqual(parseRuntimeAsset('tebako-runtime-notaver-3.3.12-macos-arm64', TRIPLETS), null);
});

test('spec 33 shapes: 4-segment langVers and universal images', () => {
  const exe = parseRuntimeAsset('tebako-runtime-2.5.0-10.1.1.0-linux-gnu-x86_64', TRIPLETS);
  assert.deepStrictEqual(
    { lang: exe?.langVer, triplet: exe?.triplet, kind: exe?.kind },
    { lang: '10.1.1.0', triplet: 'linux-gnu-x86_64', kind: 'exe' },
  );
  const uni = parseRuntimeAsset('tebako-runtime-2.5.0-10.1.1.0-universal.tfs', TRIPLETS);
  assert.deepStrictEqual(
    { lang: uni?.langVer, triplet: uni?.triplet, kind: uni?.kind },
    { lang: '10.1.1.0', triplet: 'universal', kind: 'image' },
  );
  // universal is images-only: a universal exe does not parse
  assert.strictEqual(parseRuntimeAsset('tebako-runtime-2.5.0-10.1.1.0-universal', TRIPLETS), null);
});

test('bootstrap assets parse with version + triplet, sidecars skipped', () => {
  assert.deepStrictEqual(parseBootstrapAsset('tebako-bootstrap-2.5.0-macos-arm64', TRIPLETS), {
    version: '2.5.0',
    triplet: 'macos-arm64',
  });
  assert.deepStrictEqual(parseBootstrapAsset('tebako-bootstrap-2.5.0-windows-ucrt64.exe', TRIPLETS), {
    version: '2.5.0',
    triplet: 'windows-ucrt64',
  });
  assert.strictEqual(parseBootstrapAsset('tebako-bootstrap-2.5.0-macos-arm64.sha256', TRIPLETS), null);

test('deriveTriplets: vocabulary elaborated from release asset names (SSOT)', () => {
  const names = [
    'manifest.json',
    'SHA256SUMS.txt',
    'tebako-runtime-0.16.22-3.3.12-macos-arm64',
    'tebako-runtime-0.16.22-3.3.12-macos-arm64.tfs',
    'tebako-runtime-0.16.22-3.3.12-macos-arm64.manifest.json',
    'tebako-runtime-0.16.22-3.3.12-windows-ucrt64.exe',
    'tebako-runtime-0.1.2-3.13.15-jit-linux-gnu-arm64.tfs',
    'tebako-runtime-2.5.0-10.1.1.0-universal.tfs',
    'tebako-runtime-2.5.0-10.1.1.0-linux-gnu-x86_64',
  ];
  assert.deepStrictEqual(deriveTriplets(names), [
    'linux-gnu-arm64', // the jit flavor is correctly NOT part of the triplet
    'linux-gnu-x86_64',
    'macos-arm64',
    'universal',
    'windows-ucrt64',
  ]);
  assert.deepStrictEqual(deriveTriplets(['unrelated.txt']), []);
});
});
