// Asset-name grammar for factory runtime releases. Pure — the collector's
// deepest, most regression-prone logic, exercised by tools/lib tests.
// Grammar: tebako-runtime-<tebakoVer>-<langVer>[-<flavor>]-<triplet> with
// suffixes: none = interpreter exe (POSIX), .exe (windows), .tfs = env image,
// .manifest.json, .dll (ucrt), .sha256 sidecars. The triplet matches a KNOWN
// LIST against the name tail — never a greedy regex — so hyphenated triplets
// (linux-gnu-x86_64, windows-ucrt64) and langVer flavor suffixes
// (3.13.15-jit) stay unambiguous.

export type AssetKind = 'exe' | 'image' | 'manifest' | 'sidecar' | 'dll';

export interface ParsedAsset {
  tebakoVer: string;
  langVer: string;
  flavor: string | null;
  triplet: string;
  kind: AssetKind;
}

export function parseRuntimeAsset(name: string, triplets: string[]): ParsedAsset | null {
  const PREFIX = 'tebako-runtime-';
  if (!name.startsWith(PREFIX)) return null;
  let stem = name.slice(PREFIX.length);
  // Signature sidecars (.asc) wrap ANY artifact (X.asc, X.tfs.asc,
  // X.exe.asc): strip the wrapper first, classify the remainder for the
  // stem, then force the sidecar kind.
  const signed = stem.endsWith('.asc');
  if (signed) stem = stem.slice(0, -'.asc'.length);
  let kind: AssetKind;
  if (stem.endsWith('.manifest.json')) {
    kind = 'manifest';
    stem = stem.slice(0, -'.manifest.json'.length);
  } else if (stem.endsWith('.tfs.sha256')) {
    kind = 'sidecar';
    stem = stem.slice(0, -'.tfs.sha256'.length);
  } else if (stem.endsWith('.sha256')) {
    kind = 'sidecar';
    stem = stem.slice(0, -'.sha256'.length);
  } else if (stem.endsWith('.tfs')) {
    kind = 'image';
    stem = stem.slice(0, -'.tfs'.length);
  } else if (stem.endsWith('.exe')) {
    kind = 'exe';
    stem = stem.slice(0, -'.exe'.length);
  } else if (stem.endsWith('.dll')) {
    kind = 'dll';
    stem = stem.slice(0, -'.dll'.length);
  } else {
    kind = 'exe';
  }
  let triplet: string | null = null;
  for (const t of triplets) {
    if (stem.endsWith('-' + t)) {
      triplet = t;
      break;
    }
  }
  if (triplet === null) {
    // spec 33 universal runtime images: one artifact serves every triplet of
    // the line (the composed runtime's triplet binding comes from its owner).
    if (kind === 'image' && stem.endsWith('-universal')) triplet = 'universal';
    else return null;
  }
  const head = stem.slice(0, stem.length - triplet.length - 1);
  const dash = head.indexOf('-');
  if (dash < 0) return null;
  const tebakoVer = head.slice(0, dash);
  if (!/^\d+(\.\d+)+$/.test(tebakoVer)) return null;
  // langVers carry as many segments as the language spells: jruby 10.1.1.0,
  // graalvm 25.0.4.1, ruby 3.3.12 — all dotted numerics.
  const m = /^(\d+(?:\.\d+)+)(?:-([a-z0-9]+))?$/.exec(head.slice(dash + 1));
  if (m === null) return null;
  return { tebakoVer, langVer: m[1], flavor: m[2] ?? null, triplet, kind: signed ? 'sidecar' : kind };
}

// tebako-bootstrap-<ver>-<triplet>[.exe] — the toolchain's asset grammar
// (same known-triplet tail matching).
export function parseBootstrapAsset(
  name: string,
  triplets: string[],
): { version: string; triplet: string } | null {
  const PREFIX = 'tebako-bootstrap-';
  if (!name.startsWith(PREFIX) || name.endsWith('.sha256')) return null;
  let stem = name.slice(PREFIX.length);
  if (stem.endsWith('.exe')) stem = stem.slice(0, -'.exe'.length);
  const triplet = triplets.find((t) => stem.endsWith('-' + t));
  if (!triplet) return null;
  const version = stem.slice(0, stem.length - triplet.length - 1);
  if (!/^\d+(\.\d+)+$/.test(version)) return null;
  return { version, triplet };
}

// The triplet vocabulary, elaborated from the releases themselves — the
// factories' asset names are the SSOT (the monolithic manifest.json is
// legacy; never read it). The naming scheme's atoms: after the two
// dotted-numeric versions (and an optional single-segment flavor), the
// triplet begins at the OS-family segment.
const OS_FAMILIES = ['macos', 'linux', 'windows'];

export function deriveTriplets(names: string[]): string[] {
  const set = new Set<string>();
  for (const name of names) {
    if (!name.startsWith('tebako-runtime-')) continue;
    let stem = name.slice('tebako-runtime-'.length);
    for (const suf of ['.manifest.json', '.tfs.sha256', '.sha256', '.tfs', '.exe', '.dll']) {
      if (stem.endsWith(suf)) {
        stem = stem.slice(0, -suf.length);
        break;
      }
    }
    const m = /^(\d+(?:\.\d+)+)-(\d+(?:\.\d+)+)-(.+)$/.exec(stem);
    if (m === null) continue;
    const segs = m[3].split('-');
    let start = -1;
    for (let i = segs.length - 1; i >= 0; i--) {
      if (segs[i] === 'universal' || OS_FAMILIES.includes(segs[i])) {
        start = i;
        break;
      }
    }
    if (start < 0) continue;
    set.add(segs.slice(start).join('-'));
  }
  return [...set].sort();
}
