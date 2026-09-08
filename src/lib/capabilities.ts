import type { RuntimeRow } from './types';

export interface CapabilityChip {
  label: string;
  note: string;
  source: string;
}

// DERIVATION RULES — this module is the FALLBACK, not the authority (plan 04:
// when a factory's published manifest carries a `capabilities:` key, that
// value wins and the site renders a flowed chip instead of these).
//
// ruby `yjit`: mirror of the factory's truth table
// (tebako-runtime-ruby build/lib/tebako_runtime_builder/capabilities.rb):
// non-windows legs of ruby >= 3.2, PLUS the 3.1 line on x86_64 only (its
// YJIT_TARGET_OK arms no aarch64). "off" on windows (no mingw arm
// upstream) and on 3.1's non-x86_64 legs.
//   ruby >= 4.0 `zjit-proto` is NEVER derived here — only flowed via the
//   factory manifest (tebako-runtime-ruby#147).
// python `jit`: flavor == 'jit'.
// other engines: no derived capabilities.
const RUBY_YJIT_RULE_OWNER =
  'https://github.com/tamatebako/tebako-runtime-ruby/blob/main/build/lib/tebako_runtime_builder/boot_smoke.rb';
const PYTHON_JIT_RULE_OWNER = 'https://github.com/tamatebako/tebako-runtime-python/releases';

export const CAPABILITY_RULE_OWNERS = {
  ruby_yjit: RUBY_YJIT_RULE_OWNER,
  python_jit: PYTHON_JIT_RULE_OWNER,
} as const;

function minorAtLeast(langVersion: string, major: number, minor: number): boolean {
  const m = /^(\d+)\.(\d+)/.exec(langVersion);
  if (m === null) return false;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  return maj > major || (maj === major && min >= minor);
}

function ruby31only(langVersion: string): boolean {
  return /^3\.1(?:\.|$)/.test(langVersion);
}

export function deriveCapabilityChips(
  row: Pick<RuntimeRow, 'engine' | 'lang_version' | 'flavor' | 'triplet'>,
): CapabilityChip[] {
  if (
    row.engine === 'ruby' &&
    !row.triplet.startsWith('windows-') &&
    (minorAtLeast(row.lang_version, 3, 2) ||
      (ruby31only(row.lang_version) && row.triplet.endsWith('x86_64')))
  ) {
    return [
      {
        label: 'yjit',
        note: 'derived: non-windows, ruby >= 3.2 (or the 3.1 line on x86_64) — rule owner linked',
        source: RUBY_YJIT_RULE_OWNER,
      },
    ];
  }
  if (row.engine === 'python' && row.flavor === 'jit') {
    return [
      {
        label: 'jit',
        note: 'derived: factory asset name carries the -jit flavor — rule owner linked',
        source: PYTHON_JIT_RULE_OWNER,
      },
    ];
  }
  return [];
}
