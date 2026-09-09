// The registry plane's pure parsers: feedstock tpkg-registry.yaml → PayloadRow,
// the org index catalog's per-package info, and SHA256SUMS text. All take
// already-parsed/plain data — the collector feeds them; tests exercise the
// real published shapes.
import type { PayloadRow } from '../../src/lib/types.ts';

// SHA256SUMS lines: `<64-hex>  <filename>` (text mode, two spaces) or
// `<64-hex> *<filename>` (binary mode).
export function parseShaSums(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

// Defensive mapping of a feedstock registry (an L3 mirror) into PayloadRows:
// unknown keys ignored, missing ones null. The registry carries artifact
// filenames + release refs, not absolute URLs — artifact_url stays null
// (never guessed); sha256 is only unambiguous for single-platform versions.
export function mapRegistry(doc: unknown, repo: string, url: string): PayloadRow[] {
  const d = doc as { payloads?: unknown[] } | null;
  if (!d || !Array.isArray(d.payloads)) return [];
  const out: PayloadRow[] = [];
  for (const p of d.payloads as Record<string, unknown>[]) {
    if (typeof p?.name !== 'string') continue;
    const versions: PayloadRow['versions'] = [];
    for (const v of Array.isArray(p.versions) ? (p.versions as Record<string, unknown>[]) : []) {
      const platformsObj =
        v?.platforms && typeof v.platforms === 'object' ? (v.platforms as Record<string, Record<string, unknown>>) : {};
      const platforms = Object.entries(platformsObj)
        .map(([platform, entry]) => ({
          platform,
          artifact: typeof entry?.artifact === 'string' ? entry.artifact : null,
          sha256: typeof entry?.sha256 === 'string' ? entry.sha256 : null,
        }))
        .sort((a, b) => a.platform.localeCompare(b.platform));
      const req = v?.runtime_requirement as Record<string, unknown> | undefined;
      versions.push({
        version: String(v?.version ?? ''),
        entrypoints: Array.isArray(v?.entrypoints) ? (v.entrypoints as unknown[]).map(String) : [],
        runtime_requirement:
          typeof req?.engine === 'string' && typeof req?.constraint === 'string'
            ? `${req.engine} ${req.constraint}`
            : null,
        platforms,
        artifact_url: null,
        sha256: platforms.length === 1 ? platforms[0].sha256 : null,
      });
    }
    out.push({
      name: p.name,
      kind: typeof p?.kind === 'string' ? p.kind : null,
      summary: typeof p?.summary === 'string' ? p.summary : null,
      registry_repo: repo,
      registry_url: url,
      versions,
    });
  }
  return out;
}

export interface CatalogInfo {
  kind: string | null;
  summary: string | null;
}

// The org index catalog (registry-of-registries): packages[] entries carry
// per-package kind + human summaries — the description source for payloads
// whose own feedstock registry doesn't spell one out.
export function harvestCatalogInfo(doc: unknown): Map<string, CatalogInfo> {
  const d = doc as { packages?: unknown[] } | null;
  const out = new Map<string, CatalogInfo>();
  if (!d || !Array.isArray(d.packages)) return out;
  for (const pkg of d.packages as Record<string, unknown>[]) {
    if (typeof pkg?.name !== 'string') continue;
    out.set(pkg.name, {
      kind: typeof pkg.kind === 'string' ? pkg.kind : null,
      summary: typeof pkg.summary === 'string' ? pkg.summary : null,
    });
  }
  return out;
}

// Fill kind/summary gaps from the catalog — descriptions flow from published
// sources, the site never authors them.
export function mergeCatalogInfo(rows: PayloadRow[], catalog: Map<string, CatalogInfo>): void {
  for (const row of rows) {
    const cat = catalog.get(row.name);
    row.kind = row.kind ?? cat?.kind ?? null;
    row.summary = row.summary ?? cat?.summary ?? null;
  }
}
