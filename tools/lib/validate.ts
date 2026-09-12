// Hand-rolled runtime checks of versions.json against the VersionsData shape
// (plan 01: no validation dependency). Pure — imported by the collector and
// exercised by tools/lib tests.
import type { VersionsData } from '../../src/lib/types.ts';

export class CollectError extends Error {}

export function need(cond: unknown, msg: string): void {
  if (!cond) throw new CollectError(`collect: schema violation: ${msg}`);
}

const isStr = (v: unknown): boolean => typeof v === 'string';

function validateArtifactRef(a: unknown, where: string): void {
  const r = a as { url?: unknown; size?: unknown; downloads?: unknown; sha256?: unknown } | null;
  need(
    r !== null &&
      isStr(r.url) &&
      typeof r.size === 'number' &&
      typeof r.downloads === 'number' &&
      (r.sha256 === null || isStr(r.sha256)),
    `${where}: artifact`,
  );
}

export function validate(data: VersionsData): void {
  need(isStr(data.generated_at), 'generated_at');
  need(Array.isArray(data.sources), 'sources[]');
  for (const s of data.sources) {
    need(isStr(s.url) && isStr(s.kind) && typeof s.ok === 'boolean', 'sources[] entry');
  }
  need(Array.isArray(data.runtimes), 'runtimes[]');
  // An empty runtimes plane is never legitimate — it means every factory
  // source yielded nothing. Refuse loudly rather than publish an empty
  // catalog (the previous deploy stays live).
  need(data.runtimes.length > 0, 'runtimes[] is empty — refusing to publish an empty catalog');
  for (const r of data.runtimes) {
    need(
      isStr(r.engine) && isStr(r.lang_version) && (r.flavor === null || isStr(r.flavor)),
      'runtime row: identity',
    );
    need(
      isStr(r.tebako_line) && isStr(r.triplet) && isStr(r.reference) && typeof r.latest_in_line === 'boolean',
      `runtime row ${r.reference}: identity`,
    );
    need(
      r.capabilities === null || (Array.isArray(r.capabilities) && r.capabilities.every(isStr)),
      `runtime row ${r.reference}: capabilities`,
    );
    if (r.exe !== null) validateArtifactRef(r.exe, `runtime ${r.reference} exe`);
    if (r.image !== null) validateArtifactRef(r.image, `runtime ${r.reference} image`);
    need(
      isStr(r.release.tag) &&
        isStr(r.release.url) &&
        isStr(r.release.published_at) &&
        typeof r.release.prerelease === 'boolean' && typeof r.release.signed === 'boolean',
      `runtime row ${r.reference}: release`,
    );
  }
  need(Array.isArray(data.payloads), 'payloads[]');
  for (const p of data.payloads) {
    need(
      isStr(p.name) &&
        (p.kind === null || isStr(p.kind)) &&
        (p.summary === null || isStr(p.summary)) &&
        isStr(p.registry_repo) &&
        isStr(p.registry_url) &&
        Array.isArray(p.versions),
      `payload ${p.name}`,
    );
    for (const v of p.versions) {
      need(
        isStr(v.version) &&
          Array.isArray(v.entrypoints) &&
          (v.runtime_requirement === null || isStr(v.runtime_requirement)) &&
          Array.isArray(v.platforms) &&
          (v.artifact_url === null || isStr(v.artifact_url)) &&
          (v.sha256 === null || isStr(v.sha256)),
        `payload ${p.name} version ${v.version}`,
      );
      for (const pf of v.platforms) {
        need(
          isStr(pf.platform) && (pf.artifact === null || isStr(pf.artifact)) && (pf.sha256 === null || isStr(pf.sha256)),
          `payload ${p.name} version ${v.version} platform ${pf.platform}`,
        );
      }
    }
  }
  need(Array.isArray(data.toolchain), 'toolchain[]');
  for (const t of data.toolchain) {
    need(
      isStr(t.version) && isStr(t.url) && isStr(t.published_at) && typeof t.signed === 'boolean' && Array.isArray(t.bootstrap),
      `toolchain ${t.version}`,
    );
    for (const b of t.bootstrap) {
      need(isStr(b.triplet) && typeof b.bytes === 'number', `toolchain ${t.version} bootstrap ${b.triplet}`);
    }
  }
}
