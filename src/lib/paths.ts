// Static-route computation and URL spelling for the catalog's pages. Route
// URLs are written here and nowhere else — getStaticPaths runs in isolation
// (no page-file bindings), which is why this module is the one import it
// needs.
import { lineViews, lineSlug, payloadVersionsDesc, type LineView } from './groups.ts';
import { loadVersions } from './data.ts';
import type { PayloadRow, PayloadVersion, VersionsData } from './types.ts';

export const INDEX_PATH = '/versions';
export const RUNTIME_PATH = '/versions/runtime';
export const PAYLOAD_PATH = '/versions/payload';

export const linePath = (engine: string, lang: string, flavor: string | null): string =>
  `${RUNTIME_PATH}/${lineSlug(engine, lang, flavor)}`;

export const payloadPath = (name: string): string => `${PAYLOAD_PATH}/${name}`;

export interface RuntimeRoute {
  params: { line: string };
  props: { view: LineView };
}

export function runtimeRoutes(): RuntimeRoute[] {
  return lineViews(loadVersions()).map((g) => ({ params: { line: g.slug }, props: { view: g } }));
}

export interface PayloadRoute {
  params: { name: string };
  props: { payload: PayloadRow; versions: PayloadVersion[] };
}

export function payloadRoutes(): PayloadRoute[] {
  return loadVersions().payloads.map((p) => ({
    params: { name: p.name },
    props: { payload: p, versions: payloadVersionsDesc(p) },
  }));
}

// Every addressable catalog page, for the sitemap.
export function sitemapPaths(v: VersionsData): string[] {
  return [
    INDEX_PATH,
    ...lineViews(v).map((g) => `${RUNTIME_PATH}/${g.slug}`),
    ...v.payloads.map((p) => `${PAYLOAD_PATH}/${p.name}`),
  ];
}
