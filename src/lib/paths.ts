// Static-route computation and URL spelling for the catalog's pages. Route
// URLs are written here and nowhere else — getStaticPaths runs in isolation
// (no page-file bindings), which is why this module is the one import it
// needs.
import { lineViews, lineSlug, payloadVersionsDesc, type LineView } from './groups.ts';
import type { PayloadRow, PayloadVersion, VersionsData } from './types.ts';

export const INDEX_PATH = '/versions/';
export const RUNTIME_PATH = '/versions/runtime';
export const PAYLOAD_PATH = '/versions/payload';

// Trailing slashes: the served (directory) form — internal links must not
// 301-hop, and canonical/sitemap/feed URLs must match what Pages serves.
export const linePath = (engine: string, lang: string, flavor: string | null): string =>
  `${RUNTIME_PATH}/${lineSlug(engine, lang, flavor)}/`;

export const payloadPath = (name: string): string => `${PAYLOAD_PATH}/${name}/`;

// A payload's runtime_requirement ("ruby ~> 3.3.0") resolves to the catalog's
// highest line matching the constraint's major.minor — the two planes connect.
export function runtimeRequirementTarget(
  req: string,
  v: VersionsData,
): { engine: string; lang: string; flavor: string | null } | null {
  const m = /^([a-z]+)\s*~>\s*(\d+\.\d+)/i.exec(req);
  if (m === null) return null;
  const engine = m[1].toLowerCase();
  const prefix = `${m[2]}.`;
  const candidates = lineViews(v).filter((lv) => lv.engine === engine && lv.lang.startsWith(prefix));
  // Prefer the unflavored line when plain and flavored builds tie — the
  // default experience satisfies the requirement as well as a flavor does.
  const best = candidates.find((lv) => lv.flavor === null) ?? candidates[0];
  return best ? { engine: best.engine, lang: best.lang, flavor: best.flavor } : null;
}

export interface RuntimeRoute {
  params: { line: string };
  props: { view: LineView };
}

// The data import is lazy: src/data/versions.json is GENERATED, and pure
// consumers (tests, sitemapPaths) must not require a build to have run.
export async function runtimeRoutes(): Promise<RuntimeRoute[]> {
  const { loadVersions } = await import('./data.ts');
  return lineViews(loadVersions()).map((g) => ({ params: { line: g.slug }, props: { view: g } }));
}

export interface PayloadRoute {
  params: { name: string };
  props: { payload: PayloadRow; versions: PayloadVersion[] };
}

export async function payloadRoutes(): Promise<PayloadRoute[]> {
  const { loadVersions } = await import('./data.ts');
  return loadVersions().payloads.map((p) => ({
    params: { name: p.name },
    props: { payload: p, versions: payloadVersionsDesc(p) },
  }));
}

// Every addressable catalog page, for the sitemap.
export function sitemapPaths(v: VersionsData): string[] {
  return [
    INDEX_PATH,
    ...lineViews(v).map((g) => `${RUNTIME_PATH}/${g.slug}/`),
    ...v.payloads.map((p) => `${PAYLOAD_PATH}/${p.name}/`),
  ];
}
