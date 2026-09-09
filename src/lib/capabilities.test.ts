import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveCapabilityChips } from '../../src/lib/capabilities.ts';

// Mirrors the factory truth table (tebako-runtime-ruby Capabilities) — the
// 3.1-x86_64 case is the one the plan-02 rule got wrong before plan 04.
test('ruby yjit: non-windows >= 3.2 on any arch', () => {
  for (const [lang, triplet] of [
    ['3.2.11', 'macos-arm64'],
    ['3.3.12', 'linux-gnu-x86_64'],
    ['3.4.10', 'linux-musl-arm64'],
    ['4.0.6', 'macos-x86_64'],
  ] as const) {
    assert.strictEqual(deriveCapabilityChips({ engine: 'ruby', lang_version: lang, flavor: null, triplet })[0]?.label, 'yjit', `${lang}/${triplet}`);
  }
});

test('ruby yjit: the 3.1 line is x86_64-only', () => {
  assert.strictEqual(deriveCapabilityChips({ engine: 'ruby', lang_version: '3.1.6', flavor: null, triplet: 'linux-gnu-x86_64' })[0]?.label, 'yjit');
  assert.strictEqual(deriveCapabilityChips({ engine: 'ruby', lang_version: '3.1.6', flavor: null, triplet: 'macos-arm64' }).length, 0);
  assert.strictEqual(deriveCapabilityChips({ engine: 'ruby', lang_version: '3.1.6', flavor: null, triplet: 'windows-ucrt64' }).length, 0);
});

test('ruby yjit: windows is always off', () => {
  assert.strictEqual(deriveCapabilityChips({ engine: 'ruby', lang_version: '4.0.6', flavor: null, triplet: 'windows-ucrt64' }).length, 0);
});

test('python jit rides the flavor', () => {
  assert.strictEqual(deriveCapabilityChips({ engine: 'python', lang_version: '3.13.15', flavor: 'jit', triplet: 'macos-arm64' })[0]?.label, 'jit');
  assert.strictEqual(deriveCapabilityChips({ engine: 'python', lang_version: '3.13.15', flavor: null, triplet: 'macos-arm64' }).length, 0);
});
