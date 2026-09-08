// Plan 01 collector: fetch the three data planes (factory releases, feedstock
// registries, product releases) into src/data/versions.json.
// Dependency-light by design: node fetch + the `yaml` npm package only.
// Failure policy: a source that fails after retries aborts the build loudly —
// never emit a half-catalog (charter: a stale-looking partial is worse than a
// failed deploy).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type {
  PayloadRow,
  RuntimeRow,
  SourceStatus,
  ToolchainRow,
  VersionsData,
} from '../src/lib/types.ts';

const API_ROOT = 'https://api.github.com';
const RAW_ROOT = 'https://raw.githubusercontent.com';
const BACKOFF_S = [5, 15, 45];
const TOKEN = process.env.GITHUB_TOKEN ?? '';

class CollectError extends Error {}

function need(cond: unknown, msg: string): void {
  if (!cond) throw new CollectError(`collect: schema violation: ${msg}`);
}

interface SourcesConfig {
  factories: { repo: string; engine: string }[];
  feedstocks: { org: string; registry_file: string };
  product: { repo: string }[];
  triplets: string[];
  checksum_names: string[];
}

function loadSources(): SourcesConfig {
  const cfg = parseYaml(readFileSync('sources.yaml', 'utf8')) as SourcesConfig;
  need(Array.isArray(cfg?.factories) && cfg.factories.length > 0, 'sources.yaml: factories missing');
  need(typeof cfg?.feedstocks?.org === 'string', 'sources.yaml: feedstocks.org missing');
  need(typeof cfg?.feedstocks?.registry_file === 'string', 'sources.yaml: feedstocks.registry_file missing');
  need(Array.isArray(cfg?.product) && cfg.product.length > 0, 'sources.yaml: product missing');
  need(Array.isArray(cfg?.triplets) && cfg.triplets.length > 0, 'sources.yaml: triplets missing');
  need(Array.isArray(cfg?.checksum_names) && cfg.checksum_names.length > 0, 'sources.yaml: checksum_names missing');
  return cfg;
}

const sleep = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));

// Retry per charter: 3 retries, 5/15/45 s backoff on 403-rate-limit / 5xx /
// TLS / DNS, then a named failure. 404 is returned to the caller (feedstock
// probes legitimately 404).
async function fetchWithRetry(url: string): Promise<Response> {
  let lastErr = 'unknown';
  for (let attempt = 0; attempt <= BACKOFF_S.length; attempt++) {
    if (attempt > 0) {
      console.error(
        `collect: retry ${attempt}/${BACKOFF_S.length} in ${BACKOFF_S[attempt - 1]}s: ${url} (${lastErr})`,
      );
      await sleep(BACKOFF_S[attempt - 1]);
    }
    try {
      const headers: Record<string, string> = {
        'user-agent': 'tebako-versions-collector',
        accept: url.startsWith(API_ROOT) ? 'application/vnd.github+json' : 'text/plain',
      };
      if (TOKEN && (url.startsWith(API_ROOT) || url.startsWith(RAW_ROOT))) {
        headers.authorization = `Bearer ${TOKEN}`;
      }
      const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
      if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
        lastErr = 'rate limit (403)';
        continue;
      }
      if (res.status >= 500) {
        lastErr = `http ${res.status}`;
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  throw new CollectError(
    `collect: FAILED after ${BACKOFF_S.length} retries: ${url} (${lastErr}) — aborting build rather than emitting partial data`,
  );
}

async function githubJson<T>(path: string): Promise<T> {
  const res = await fetchWithRetry(`${API_ROOT}${path}`);
  if (!res.ok) throw new CollectError(`collect: ${path} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

interface GhAsset {
  name: string;
  size: number;
  download_count: number;
  browser_download_url: string;
}

interface GhRelease {
  id: number;
  tag_name: string;
  html_url: string;
  published_at: string;
  draft: boolean;
  prerelease: boolean;
  assets: GhAsset[];
}

type AssetKind = 'exe' | 'image' | 'manifest' | 'sidecar' | 'dll';

interface ParsedAsset {
  tebakoVer: string;
  langVer: string;
  flavor: string | null;
  triplet: string;
  kind: AssetKind;
}

// Asset grammar: tebako-runtime-<tebakoVer>-<langVer>[-<flavor>]-<triplet>
// with suffixes: none = interpreter exe (POSIX), .exe (windows), .tfs = env
// image, .manifest.json, .dll (ucrt), .sha256 sidecars. The triplet is matched
// from the KNOWN LIST against the name tail — never a greedy regex — so
// hyphenated triplets (linux-gnu-x86_64, windows-ucrt64) and langVer flavor
// suffixes (3.13.15-jit) stay unambiguous.
function parseRuntimeAsset(name: string, triplets: string[]): ParsedAsset | null {
  const PREFIX = 'tebako-runtime-';
  if (!name.startsWith(PREFIX)) return null;
  let stem = name.slice(PREFIX.length);
  let kind: AssetKind;
  if (stem.endsWith('.manifest.json')) {
    kind = 'manifest';
    stem = stem.slice(0, -'.manifest.json'.length);
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
  if (triplet === null) return null;
  const head = stem.slice(0, stem.length - triplet.length - 1);
  const dash = head.indexOf('-');
  if (dash < 0) return null;
  const tebakoVer = head.slice(0, dash);
  if (!/^\d+(\.\d+)+$/.test(tebakoVer)) return null;
  const m = /^(\d+\.\d+(?:\.\d+)?)(?:-([a-z0-9]+))?$/.exec(head.slice(dash + 1));
  if (m === null) return null;
  return { tebakoVer, langVer: m[1], flavor: m[2] ?? null, triplet, kind };
}

async function collectFactory(
  repo: string,
  engine: string,
  cfg: SourcesConfig,
  statuses: SourceStatus[],
): Promise<RuntimeRow[]> {
  const releases = (
    await githubJson<GhRelease[]>(`/repos/${repo}/releases?per_page=20`)
  ).filter((r) => !r.draft);
  statuses.push({
    url: `${API_ROOT}/repos/${repo}/releases?per_page=20`,
    kind: 'factory-release',
    ok: true,
    note: `${releases.length} non-draft releases`,
  });

  interface RowDraft {
    release: GhRelease;
    tebakoVer: string;
    langVer: string;
    flavor: string | null;
    triplet: string;
    exe: GhAsset | null;
    image: GhAsset | null;
  }
  const rows = new Map<string, RowDraft>();
  for (const rel of releases) {
    const tagVer = rel.tag_name.replace(/^v/, '');
    for (const asset of rel.assets) {
      const p = parseRuntimeAsset(asset.name, cfg.triplets);
      if (p === null || p.kind === 'manifest' || p.kind === 'sidecar' || p.kind === 'dll') continue;
      if (p.tebakoVer !== tagVer) continue;
      const key = `${rel.id}|${p.langVer}|${p.flavor ?? ''}|${p.triplet}`;
      let d = rows.get(key);
      if (!d) {
        d = {
          release: rel,
          tebakoVer: p.tebakoVer,
          langVer: p.langVer,
          flavor: p.flavor,
          triplet: p.triplet,
          exe: null,
          image: null,
        };
        rows.set(key, d);
      }
      if (p.kind === 'exe') d.exe ??= asset;
      else d.image ??= asset;
    }
  }

  // Latest release per line (line = engine + lang_version + flavor): the
  // newest published release carrying that line.
  const latestReleaseByLine = new Map<string, { published_at: string; releaseId: number }>();
  for (const d of rows.values()) {
    const line = `${d.langVer}|${d.flavor ?? ''}`;
    const cur = latestReleaseByLine.get(line);
    const cand = { published_at: d.release.published_at, releaseId: d.release.id };
    if (
      !cur ||
      cand.published_at > cur.published_at ||
      (cand.published_at === cur.published_at && cand.releaseId > cur.releaseId)
    ) {
      latestReleaseByLine.set(line, cand);
    }
  }

  // Checksum: fetch the checksum asset of the LATEST release per line only
  // (deduplicated across lines that share that release). Older rows keep
  // sha256: null — never guess.
  const checksumReleases = new Map<number, GhRelease>();
  for (const info of latestReleaseByLine.values()) {
    const rel = releases.find((r) => r.id === info.releaseId);
    if (rel) checksumReleases.set(rel.id, rel);
  }
  const shaByRelease = new Map<number, Map<string, string>>();
  for (const rel of checksumReleases.values()) {
    const asset = cfg.checksum_names
      .map((n) => rel.assets.find((a) => a.name === n))
      .find((a) => a !== undefined);
    if (!asset) {
      statuses.push({
        url: rel.html_url,
        kind: 'checksum',
        ok: false,
        note: `no checksum asset (${cfg.checksum_names.join(' / ')}) in ${rel.tag_name}; sha256 stays null`,
      });
      continue;
    }
    const res = await fetchWithRetry(asset.browser_download_url);
    if (!res.ok) throw new CollectError(`collect: checksum ${asset.browser_download_url} -> HTTP ${res.status}`);
    const map = new Map<string, string>();
    for (const line of (await res.text()).split('\n')) {
      const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
      if (m) map.set(m[2], m[1]);
    }
    statuses.push({
      url: asset.browser_download_url,
      kind: 'checksum',
      ok: true,
      note: `${rel.tag_name}: ${map.size} entries`,
    });
    shaByRelease.set(rel.id, map);
  }

  // Capability flow (plan 04): for latest-in-line rows only, fetch the
  // per-runtime .manifest.json shard and read its additive `capabilities`
  // key. Bounded to one small CDN download per (line × triplet) of the
  // latest releases. Absent key, missing shard, or fetch miss → null (the
  // page derives and marks it) — display metadata never fails the build.
  const manifestCaps = new Map<string, string[] | null>();
  let capMisses = 0;
  const latestDrafts = [...rows.values()].filter(
    (d) =>
      d.exe !== null &&
      latestReleaseByLine.get(`${d.langVer}|${d.flavor ?? ''}`)!.releaseId === d.release.id,
  );
  for (let i = 0; i < latestDrafts.length; i += 6) {
    const chunk = latestDrafts.slice(i, i + 6);
    await Promise.all(
      chunk.map(async (d) => {
        const exe = d.exe!;
        try {
          const asset = d.release.assets.find((a) => a.name === `${exe.name}.manifest.json`);
          if (!asset) {
            manifestCaps.set(exe.name, null);
            return;
          }
          const res = await fetchWithRetry(asset.browser_download_url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const doc = JSON.parse(await res.text()) as { capabilities?: unknown };
          manifestCaps.set(
            exe.name,
            Array.isArray(doc?.capabilities) ? doc.capabilities.map(String) : null,
          );
        } catch {
          capMisses++;
          manifestCaps.set(exe.name, null);
        }
      }),
    );
  }

  const out: RuntimeRow[] = [];
  if (capMisses > 0) {
    statuses.push({
      url: `${API_ROOT}/repos/${repo}/releases?per_page=20`,
      kind: 'factory-release',
      ok: true,
      note: `${capMisses} capability-manifest fetch misses (chips stay derived)`,
    });
  }
  for (const d of rows.values()) {
    const line = `${d.langVer}|${d.flavor ?? ''}`;
    const shaMap = shaByRelease.get(d.release.id);
    out.push({
      engine,
      lang_version: d.langVer,
      flavor: d.flavor,
      tebako_line: d.tebakoVer,
      triplet: d.triplet,
      reference: `${engine}@${d.langVer};tebako=${d.tebakoVer};image`,
      latest_in_line: latestReleaseByLine.get(line)!.releaseId === d.release.id,
      capabilities: (d.exe && manifestCaps.get(d.exe.name)) ?? null,
      exe: d.exe
        ? {
            url: d.exe.browser_download_url,
            size: d.exe.size,
            downloads: d.exe.download_count,
            sha256: shaMap?.get(d.exe.name) ?? null,
          }
        : null,
      image: d.image
        ? {
            url: d.image.browser_download_url,
            size: d.image.size,
            downloads: d.image.download_count,
            sha256: shaMap?.get(d.image.name) ?? null,
          }
        : null,
      release: {
        tag: d.release.tag_name,
        url: d.release.html_url,
        published_at: d.release.published_at,
        prerelease: d.release.prerelease,
      },
    });
  }
  return out;
}

interface GhRepo {
  name: string;
  default_branch: string;
}

function mapRegistry(doc: unknown, repo: string, url: string): PayloadRow[] {
  const d = doc as { payloads?: unknown[] } | null;
  if (!d || !Array.isArray(d.payloads)) return [];
  const out: PayloadRow[] = [];
  for (const p of d.payloads as Record<string, unknown>[]) {
    if (typeof p?.name !== 'string') continue;
    const versions: PayloadRow['versions'] = [];
    for (const v of Array.isArray(p.versions) ? (p.versions as Record<string, unknown>[]) : []) {
      const platformsObj =
        v?.platforms && typeof v.platforms === 'object' ? (v.platforms as Record<string, Record<string, unknown>>) : {};
      const platforms = Object.keys(platformsObj).sort();
      const req = v?.runtime_requirement as Record<string, unknown> | undefined;
      const single = platforms.length === 1 ? platformsObj[platforms[0]] : undefined;
      versions.push({
        version: String(v?.version ?? ''),
        entrypoints: Array.isArray(v?.entrypoints) ? (v.entrypoints as unknown[]).map(String) : [],
        runtime_requirement:
          typeof req?.engine === 'string' && typeof req?.constraint === 'string'
            ? `${req.engine} ${req.constraint}`
            : null,
        platforms,
        // The registry carries artifact filenames + release refs, not absolute
        // URLs — never guess one. sha256 is only unambiguous for single-platform
        // versions; otherwise null.
        artifact_url: null,
        sha256: single && typeof single.sha256 === 'string' ? single.sha256 : null,
      });
    }
    out.push({ name: p.name, registry_repo: repo, registry_url: url, versions });
  }
  return out;
}

async function collectFeedstocks(
  cfg: SourcesConfig,
  statuses: SourceStatus[],
): Promise<{ rows: PayloadRow[]; probed: number; skipped: number; pointer: number }> {
  const repos: GhRepo[] = [];
  for (const page of [1, 2]) {
    const batch = await githubJson<GhRepo[]>(`/orgs/${cfg.feedstocks.org}/repos?per_page=100&page=${page}`);
    repos.push(...batch);
    if (batch.length < 100) break;
    if (page === 2 && batch.length === 100) {
      throw new CollectError(`collect: org ${cfg.feedstocks.org} exceeds 200 repos — widen pagination`);
    }
  }
  const rows: PayloadRow[] = [];
  let skipped = 0;
  let pointerRegistries = 0;
  for (const repo of repos) {
    const url = `${RAW_ROOT}/${cfg.feedstocks.org}/${repo.name}/${repo.default_branch}/${cfg.feedstocks.registry_file}`;
    const res = await fetchWithRetry(url);
    // A repo without the registry file is skipped (counted, not an error).
    if (res.status === 404) {
      skipped++;
      continue;
    }
    if (!res.ok) {
      statuses.push({ url, kind: 'registry', ok: false, note: `HTTP ${res.status}` });
      continue;
    }
    let doc: unknown;
    try {
      doc = parseYaml(await res.text());
    } catch (err) {
      statuses.push({
        url,
        kind: 'registry',
        ok: false,
        note: `yaml parse failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    const mapped = mapRegistry(doc, `${cfg.feedstocks.org}/${repo.name}`, url);
    if (mapped.length === 0) {
      // Catalog/pointer registries (e.g. the org index, unreleased feedstocks)
      // legitimately carry no versioned payloads[] — a valid observation, not
      // a source failure.
      pointerRegistries++;
      statuses.push({ url, kind: 'registry', ok: true, note: 'no payloads[] (catalog/pointer registry)' });
      continue;
    }
    rows.push(...mapped);
    statuses.push({ url, kind: 'registry', ok: true, note: `${mapped.length} payload(s)` });
  }
  return { rows, probed: repos.length, skipped, pointer: pointerRegistries };
}

async function collectToolchain(
  repo: string,
  cfg: SourcesConfig,
  statuses: SourceStatus[],
): Promise<ToolchainRow[]> {
  const releases = (
    await githubJson<GhRelease[]>(`/repos/${repo}/releases?per_page=5`)
  ).filter((r) => !r.draft);
  statuses.push({
    url: `${API_ROOT}/repos/${repo}/releases?per_page=5`,
    kind: 'product-release',
    ok: true,
    note: `${releases.length} non-draft releases`,
  });
  const out: ToolchainRow[] = [];
  for (const rel of releases) {
    const bootstrap: ToolchainRow['bootstrap'] = [];
    for (const asset of rel.assets) {
      // Asset grammar: tebako-bootstrap-<ver>-<triplet>[.exe]; .sha256 sidecars skipped.
      if (!asset.name.startsWith('tebako-bootstrap-') || asset.name.endsWith('.sha256')) continue;
      let stem = asset.name.slice('tebako-bootstrap-'.length);
      if (stem.endsWith('.exe')) stem = stem.slice(0, -'.exe'.length);
      const triplet = cfg.triplets.find((t) => stem.endsWith('-' + t));
      if (!triplet) continue;
      const ver = stem.slice(0, stem.length - triplet.length - 1);
      if (!/^\d+(\.\d+)+$/.test(ver)) continue;
      bootstrap.push({ triplet, bytes: asset.size });
    }
    bootstrap.sort((a, b) => a.triplet.localeCompare(b.triplet));
    out.push({
      version: rel.tag_name.replace(/^v/, ''),
      url: rel.html_url,
      published_at: rel.published_at,
      bootstrap,
    });
  }
  return out;
}

const isStr = (v: unknown): boolean => typeof v === 'string';

function validateArtifactRef(a: unknown, where: string): void {
  const r = a as Record<string, unknown> | null;
  need(r !== null && isStr(r.url) && typeof r.size === 'number' && typeof r.downloads === 'number' && (r.sha256 === null || isStr(r.sha256)), `${where}: artifact`);
}

// Hand-rolled runtime check of versions.json against the VersionsData shape
// (plan 01: no new validation dependency).
function validate(data: VersionsData): void {
  need(isStr(data.generated_at), 'generated_at');
  need(Array.isArray(data.sources), 'sources[]');
  for (const s of data.sources) {
    need(isStr(s.url) && isStr(s.kind) && typeof s.ok === 'boolean', 'sources[] entry');
  }
  need(Array.isArray(data.runtimes), 'runtimes[]');
  for (const r of data.runtimes) {
    need(isStr(r.engine) && isStr(r.lang_version) && (r.flavor === null || isStr(r.flavor)), 'runtime row: identity');
    need(isStr(r.tebako_line) && isStr(r.triplet) && isStr(r.reference) && typeof r.latest_in_line === 'boolean', `runtime row ${r.reference}: identity`);
    need(r.capabilities === null || (Array.isArray(r.capabilities) && r.capabilities.every(isStr)), `runtime row ${r.reference}: capabilities`);
    if (r.exe !== null) validateArtifactRef(r.exe, `runtime ${r.reference} exe`);
    if (r.image !== null) validateArtifactRef(r.image, `runtime ${r.reference} image`);
    need(isStr(r.release.tag) && isStr(r.release.url) && isStr(r.release.published_at) && typeof r.release.prerelease === 'boolean', `runtime row ${r.reference}: release`);
  }
  need(Array.isArray(data.payloads), 'payloads[]');
  for (const p of data.payloads) {
    need(isStr(p.name) && isStr(p.registry_repo) && isStr(p.registry_url) && Array.isArray(p.versions), `payload ${p.name}`);
    for (const v of p.versions) {
      need(isStr(v.version) && Array.isArray(v.entrypoints) && (v.runtime_requirement === null || isStr(v.runtime_requirement)) && Array.isArray(v.platforms) && (v.artifact_url === null || isStr(v.artifact_url)) && (v.sha256 === null || isStr(v.sha256)), `payload ${p.name} version ${v.version}`);
    }
  }
  need(Array.isArray(data.toolchain), 'toolchain[]');
  for (const t of data.toolchain) {
    need(isStr(t.version) && isStr(t.url) && isStr(t.published_at) && Array.isArray(t.bootstrap), `toolchain ${t.version}`);
    for (const b of t.bootstrap) {
      need(isStr(b.triplet) && typeof b.bytes === 'number', `toolchain ${t.version} bootstrap ${b.triplet}`);
    }
  }
}

const versionKey = (v: string): number[] => v.split('.').map((n) => Number(n) || 0);

function cmpArr(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function compareRuntime(a: RuntimeRow, b: RuntimeRow): number {
  return (
    a.engine.localeCompare(b.engine) ||
    -cmpArr(versionKey(a.lang_version), versionKey(b.lang_version)) ||
    (a.flavor ?? '').localeCompare(b.flavor ?? '') ||
    a.triplet.localeCompare(b.triplet) ||
    -cmpArr(versionKey(a.tebako_line), versionKey(b.tebako_line))
  );
}

async function main(): Promise<void> {
  if (process.env.VERSIONS_OFFLINE === '1') {
    mkdirSync('src/data', { recursive: true });
    copyFileSync('fixtures/versions.sample.json', 'src/data/versions.json');
    console.log('collect: VERSIONS_OFFLINE=1 — using fixtures/versions.sample.json');
    return;
  }
  const cfg = loadSources();
  const statuses: SourceStatus[] = [];

  const runtimes: RuntimeRow[] = [];
  for (const f of cfg.factories) {
    runtimes.push(...(await collectFactory(f.repo, f.engine, cfg, statuses)));
  }

  const feed = await collectFeedstocks(cfg, statuses);

  const toolchain: ToolchainRow[] = [];
  for (const p of cfg.product) {
    toolchain.push(...(await collectToolchain(p.repo, cfg, statuses)));
  }

  const byEngine = new Map<string, number>();
  for (const r of runtimes) byEngine.set(r.engine, (byEngine.get(r.engine) ?? 0) + 1);
  const parts = [...byEngine.entries()].map(([e, n]) => `${e} ${n}`);
  const flowed = runtimes.filter((r) => r.capabilities !== null).length;

  const data: VersionsData = {
    generated_at: new Date().toISOString(),
    sources: statuses,
    runtimes: runtimes.sort(compareRuntime),
    payloads: feed.rows.sort((a, b) => a.name.localeCompare(b.name)),
    toolchain: toolchain.sort((a, b) => b.published_at.localeCompare(a.published_at)),
  };
  validate(data);
  mkdirSync('src/data', { recursive: true });
  writeFileSync('src/data/versions.json', `${JSON.stringify(data, null, 2)}\n`);
  console.log(
    `collect: runtimes: ${data.runtimes.length} rows (${parts.join(', ')}) · payloads: ${data.payloads.length} · toolchain: ${data.toolchain.length}`,
  );
  console.log(
    `collect: capabilities: ${flowed} flowed from factory manifests, ${data.runtimes.length - flowed} derived (fallback)`,
  );
  console.log(
    `collect: feedstocks: ${feed.probed} probed, ${feed.skipped} without ${cfg.feedstocks.registry_file}, ${feed.pointer} pointer registries`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
