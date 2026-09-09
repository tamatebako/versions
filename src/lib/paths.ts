// Static-route computation for the detail pages. getStaticPaths runs in
// isolation (no page-file bindings) — this module is the one import it needs.
import { lineViews, payloadVersionsDesc, type LineView } from './groups';
import { loadVersions } from './data';
import type { PayloadRow, PayloadVersion } from './types';

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
