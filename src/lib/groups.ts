import type { PayloadRow, RuntimeReleaseRef, RuntimeRow, VersionsData } from './types';

const versionKey = (s: string): number[] => s.split('.').map((n) => Number(n) || 0);

function cmpVersions(a: string, b: string): number {
  const ka = versionKey(a);
  const kb = versionKey(b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (ka[i] ?? 0) - (kb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface LineReleaseGroup {
  tebakoLine: string;
  isLatest: boolean;
  release: RuntimeReleaseRef;
  rows: RuntimeRow[];
}

export interface LineView {
  slug: string;
  engine: string;
  lang: string;
  flavor: string | null;
  latestTebako: string;
  groups: LineReleaseGroup[];
  releaseCount: number;
  tripletCount: number;
}

export const lineSlug = (engine: string, lang: string, flavor: string | null): string =>
  `${engine}-${lang}${flavor ? `-${flavor}` : ''}`;

export function lineViews(v: VersionsData): LineView[] {
  const byLine = new Map<string, RuntimeRow[]>();
  for (const r of v.runtimes) {
    const key = `${r.engine}|${r.lang_version}|${r.flavor ?? ''}`;
    const rows = byLine.get(key) ?? [];
    rows.push(r);
    byLine.set(key, rows);
  }
  const views: LineView[] = [];
  for (const [key, rows] of byLine) {
    const [engine, lang, flavor] = key.split('|');
    const byTebako = new Map<string, RuntimeRow[]>();
    for (const r of rows) {
      const g = byTebako.get(r.tebako_line) ?? [];
      g.push(r);
      byTebako.set(r.tebako_line, g);
    }
    const tebakoLines = [...byTebako.keys()].sort((a, b) => -cmpVersions(a, b));
    const groups: LineReleaseGroup[] = tebakoLines.map((t) => {
      const gRows = byTebako.get(t)!.sort((a, b) => a.triplet.localeCompare(b.triplet));
      return {
        tebakoLine: t,
        isLatest: gRows.some((r) => r.latest_in_line),
        release: gRows[0].release,
        rows: gRows,
      };
    });
    views.push({
      slug: lineSlug(engine, lang, flavor === '' ? null : flavor),
      engine,
      lang,
      flavor: flavor === '' ? null : flavor,
      latestTebako: tebakoLines[0],
      groups,
      releaseCount: groups.length,
      tripletCount: new Set(rows.map((r) => r.triplet)).size,
    });
  }
  return views.sort(
    (a, b) =>
      a.engine.localeCompare(b.engine) ||
      -cmpVersions(a.lang, b.lang) ||
      (a.flavor ?? '').localeCompare(b.flavor ?? ''),
  );
}

export function payloadVersionsDesc(p: PayloadRow): PayloadRow['versions'] {
  return [...p.versions].sort((a, b) => -cmpVersions(a.version, b.version));
}
