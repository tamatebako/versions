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
// ruby `yjit`: lang_version >= 3.2 AND triplet != windows-ucrt64.
//   Rule owner: tebako-runtime-ruby, build/lib/tebako_runtime_builder/boot_smoke.rb
//   (BootSmoke#derived_yjit_state). Windows excluded: upstream CRuby lacks
//   mingw-x64 YJIT.
//   ruby >= 4.0 `zjit-proto` is NEVER derived here — it only renders when the
//   manifest flows it (tebako-runtime-ruby#147).
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

export function deriveCapabilityChips(
  row: Pick<RuntimeRow, 'engine' | 'lang_version' | 'flavor' | 'triplet'>,
): CapabilityChip[] {
  if (row.engine === 'ruby' && minorAtLeast(row.lang_version, 3, 2) && row.triplet !== 'windows-ucrt64') {
    return [
      {
        label: 'yjit',
        note: 'derived: ruby >= 3.2 on non-windows — rule owner linked',
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
