// Plan 01 collector: fetch the three data planes (factory releases, feedstock
// registries, product releases) into src/data/versions.json.
// Dependency-light by design: node fetch + the `yaml` npm package only.
// Failure policy: a source that fails after retries aborts the build loudly —
// never emit a half-catalog (charter: a stale-looking partial is worse than a
// failed deploy).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { parseRuntimeAsset, parseBootstrapAsset } from './lib/grammar.ts';
import { parseShaSums, mapRegistry, harvestCatalogInfo, mergeCatalogInfo } from './lib/registry.ts';
import { CollectError, need, validate } from './lib/validate.ts';
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

interface SourcesConfig {
  factories: { repo: string; engine: string }[];
  feedstocks: { org: string; registry_file: string; repos?: string[] };
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

// Asset grammar: tebako-runtime-<tebakoVer>-<langVer>[-<flavor>]-<triplet>
// with suffixes: none = interpreter exe (POSIX), .exe (windows), .tfs = env
// image, .manifest.json, .dll (ucrt), .sha256 sidecars. The triplet is matched
// from the KNOWN LIST against the name tail — never a greedy regex — so
// hyphenated triplets (linux-gnu-x86_64, windows-ucrt64) and langVer flavor
// suffixes (3.13.15-jit) stay unambiguous.
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

  // spec 33 universal images: a `…-universal.tfs` asset serves every triplet
  // of its line — fold it into the rows that have no exact-triplet image,
  // and drop the pseudo-row afterwards.
  const universalByReleaseLine = new Map<string, GhAsset>();
  for (const d of rows.values()) {
    if (d.triplet === 'universal' && d.image !== null) {
      universalByReleaseLine.set(`${d.release.id}|${d.langVer}|${d.flavor ?? ''}`, d.image);
    }
  }
  for (const d of rows.values()) {
    if (d.image === null && d.triplet !== 'universal') {
      d.image = universalByReleaseLine.get(`${d.release.id}|${d.langVer}|${d.flavor ?? ''}`) ?? null;
    }
  }
  for (const [key, d] of [...rows.entries()]) {
    if (d.triplet === 'universal') rows.delete(key);
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
    const map = parseShaSums(await res.text());
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
  // Runtime feedstocks in other orgs (spec 33): probe their in-repo
  // registries explicitly — the org scan cannot see them.
  const extra: GhRepo[] = [];
  for (const repo of cfg.feedstocks.repos ?? []) {
    const info = await githubJson<GhRepo & { full_name: string }>(`/repos/${repo}`);
    extra.push({ name: info.full_name, default_branch: info.default_branch });
  }
  const rows: PayloadRow[] = [];
  const catalogInfo = new Map<string, Map<string, { kind: string | null; summary: string | null }>>();
  let skipped = 0;
  let pointerRegistries = 0;
  for (const repo of [...repos.map((r) => ({ name: `${cfg.feedstocks.org}/${r.name}`, default_branch: r.default_branch })), ...extra]) {
    const url = `${RAW_ROOT}/${repo.name}/${repo.default_branch}/${cfg.feedstocks.registry_file}`;
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
    const mapped = mapRegistry(doc, repo.name, url);
    if (mapped.length === 0) {
      // Catalog/pointer registries (e.g. the org index, unreleased feedstocks)
      // legitimately carry no versioned payloads[] — a valid observation, not
      // a source failure.
      pointerRegistries++;
      catalogInfo.set(url, harvestCatalogInfo(doc));
      statuses.push({ url, kind: 'registry', ok: true, note: 'no payloads[] (catalog/pointer registry)' });
      continue;
    }
    rows.push(...mapped);
    statuses.push({ url, kind: 'registry', ok: true, note: `${mapped.length} payload(s)` });
  }
  // Fill kind/summary gaps from the org index catalog (a pointer registry):
  // descriptions flow from published sources — the site never authors them.
  const catalogEntries = new Map<string, { kind: string | null; summary: string | null }>();
  for (const harvested of catalogInfo.values()) {
    for (const [name, entry] of harvested) {
      if (!catalogEntries.has(name)) catalogEntries.set(name, entry);
    }
  }
  mergeCatalogInfo(rows, catalogEntries);
  return { rows, probed: repos.length + extra.length, skipped, pointer: pointerRegistries };
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
      const parsed = parseBootstrapAsset(asset.name, cfg.triplets);
      if (parsed) bootstrap.push({ triplet: parsed.triplet, bytes: asset.size });
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

// Hand-rolled runtime check of versions.json against the VersionsData shape
// (plan 01: no new validation dependency).

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
