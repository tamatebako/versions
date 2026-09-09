// Shared display derivations — pure, test-covered. The pages render; this
// module decides how values are spelled.

export const mib = (bytes: number): string => (bytes / 1_048_576).toFixed(1);

export function relAge(iso: string, now: Date): string {
  const h = Math.floor((now.getTime() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

// TEBAKO_<TOOL>_VERSION from an entrypoint name (verified spellings:
// metanorma-tr -> TEBAKO_METANORMA_TR_VERSION).
export const envName = (tool: string): string =>
  `TEBAKO_${tool.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_VERSION`;

export const badge = (label: string, rhs: string): string =>
  `[![${label}](https://img.shields.io/badge/${encodeURIComponent(label)}-${encodeURIComponent(rhs)}-blue)](https://www.tebako.org/versions)`;
