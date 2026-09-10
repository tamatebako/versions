import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from './validate.ts';
import { BOOTSTRAP_MAX_BYTES } from '../../src/lib/gates.ts';
import type { VersionsData } from '../../src/lib/types.ts';

// The fixture is the offline build's data contract: it must satisfy the
// schema exactly like live-collected data, and it must exercise every
// rendering branch so the offline CI leg is a real layout regression net
// (flowed/derived/absent capability chips, prerelease, flavor, 3.1-x86_64
// yjit, sha-null older rows, multi-version payloads, gate pass AND fail).
const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/versions.sample.json', import.meta.url), 'utf8'),
) as VersionsData;

test('fixture satisfies the VersionsData schema (no offline drift)', () => {
  validate(fixture);
});

test('fixture exercises the rendering branches', () => {
  const rows = fixture.runtimes;
  assert.ok(rows.some((r) => Array.isArray(r.capabilities) && r.capabilities.length > 0), 'a flowed chip');
  assert.ok(rows.some((r) => Array.isArray(r.capabilities) && r.capabilities.length === 0), 'a flowed-empty chip');
  assert.ok(rows.some((r) => r.capabilities === null && r.engine === 'ruby' && r.lang_version.startsWith('3.1') && r.triplet.endsWith('x86_64')), 'the derived 3.1-x86_64 yjit branch');
  assert.ok(rows.some((r) => r.capabilities === null && r.flavor === 'jit'), 'the derived jit-flavor branch');
  assert.ok(rows.some((r) => r.release.prerelease), 'a prerelease chip');
  assert.ok(rows.some((r) => r.flavor !== null), 'a flavor chip');
  assert.ok(rows.some((r) => r.exe?.sha256 === null), 'a sha-null row');

  // spec 33 shapes: a 4-segment line with the universal image paired into
  // every triplet, and a kind: runtime payload entry
  assert.ok(rows.some((r) => r.engine === 'jruby' && r.lang_version.split('.').length === 4), 'a 4-segment langVer line');
  assert.ok(rows.filter((r) => r.engine === 'jruby' && r.image !== null).every((r) => r.image!.size === rows.find((x) => x.engine === 'jruby')!.image!.size), 'universal image shared across triplets');
  assert.ok(fixture.payloads.some((p) => p.kind === 'runtime'), 'a kind: runtime payload');

  const multi = fixture.payloads.find((p) => p.versions.length >= 2);
  assert.ok(multi, 'a multi-version payload');

  const bootstraps = fixture.toolchain.flatMap((t) => t.bootstrap);
  assert.ok(bootstraps.some((b) => b.bytes < BOOTSTRAP_MAX_BYTES), 'a gate-PASS chip');
  assert.ok(bootstraps.some((b) => b.bytes >= BOOTSTRAP_MAX_BYTES), 'a gate-FAIL chip');
});
