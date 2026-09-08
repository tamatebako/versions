# 01 — scaffold and the data collector

**Goal:** a runnable Astro static site skeleton plus `tools/collect` — the
build-time data fetcher that turns the three data planes into
`src/data/versions.json`. No page design yet (plan 02 renders it).

**Depends on:** nothing. **Blocks:** 02, 03.

## Context (verified, trust it)

- Asset name grammar (runtime factories):
  `tebako-runtime-<tebakoVer>-<langVer>-<triplet>` plus suffixes
  (none = interpreter exe, `.exe` on windows, `.tfs` = env image,
  `.manifest.json`, `.dll` on ucrt, `.sha256` sidecars exist on some repos).
  Both `tebakoVer` and `langVer` are dotted numerics; langVer may later
  carry a flavor suffix (the python jit flavor is in flight — expect
  spellings like `3.13.15-jit`; code the parser to tolerate
  `-[a-z0-9]+` suffixes on langVer and to EXPOSE the suffix as the flavor).
- Triplet set today: `macos-arm64`, `macos-x86_64`, `linux-gnu-x86_64`,
  `linux-gnu-arm64`, `linux-musl-x86_64`, `linux-musl-arm64`,
  `windows-ucrt64`. Parse by matching the triplet from a KNOWN LIST (in
  `sources.yaml`) against the name tail — never a greedy regex; new triplets
  are additive in config.
- Checksum file: `SHA256SUMS.txt` (ruby factory verified); accept
  `SHA256SUMS` too. Format: `<64-hex>  <filename>` per line.
- Feedstock org: `tebako-packages` (`gh repo list tebako-packages --limit 50
  --json name,defaultBranchRef`). Registry probe URL:
  `https://raw.githubusercontent.com/tebako-packages/<name>/<defaultBranch>/tpkg-registry.yaml`.
  Repos without the file are skipped (counted in the report, not an error).
- Rate limits: unauthenticated GitHub API is 60 req/h — always send
  `Authorization: Bearer $GITHUB_TOKEN` when set (CI provides it
  automatically); local dev: `gh auth token`. Keep total requests bounded:
  releases list per repo (1–2 pages), one checksum fetch per LATEST release
  per factory line in v1, one raw file per feedstock. Do NOT fan out to
  per-asset manifest.json fetches in v1 (that's plan 04's flow).

## Steps

1. **Init**: in `~/src/tamatebako/versions` run `git init`; the
   `TODO.impl/` plans are already on disk — first commit is
   `plans: the TODO.impl contract` containing exactly those files.
2. **Scaffold**: minimal Astro static site. `npm create astro@latest . --
   --template minimal --install --no-git --typescript strict` (pin the
   Astro version in package.json; commit `package-lock.json`). In
   `astro.config.mjs`: `site: 'https://www.tebako.org'`, `base: '/versions'`,
   `output: 'static'`, `trailingSlash: 'ignore'`. Node LTS; add
   `.nvmrc` (`lts/*`). Add `.gitignore` (node_modules, dist,
   `src/data/versions.json` — generated).
3. **Authored config** `sources.yaml` (repo root; YAML law):

   ```yaml
   factories:
     - { repo: tamatebako/tebako-runtime-ruby,   engine: ruby }
     - { repo: tamatebako/tebako-runtime-python, engine: python }
   feedstocks:
     org: tebako-packages
     registry_file: tpkg-registry.yaml
   product:
     - { repo: tamatebako/tebako }
   triplets: [macos-arm64, macos-x86_64, linux-gnu-x86_64, linux-gnu-arm64,
              linux-musl-x86_64, linux-musl-arm64, windows-ucrt64]
   checksum_names: [SHA256SUMS.txt, SHA256SUMS]
   ```

4. **Collector** `tools/collect.ts` (run via `tsx` or compile-free
   `node --experimental-strip-types` — match what the repo's node supports;
   keep it dependency-light: fetch + a YAML parser (`yaml` npm) only):
   - Reads `sources.yaml`.
   - For each factory: `GET /repos/{repo}/releases?per_page=20` (skip
     drafts; include prereleases but tag them), pick releases per line
     (group by parsed langVer; latest per line = `latest: true`), parse
     asset names against the triplet list, pair exe+image per (line,
     triplet), fetch the checksum file of the LATEST release per line and
     attach `sha256` to exe/image rows (rows from older releases get
     `sha256: null` — never guess).
   - For each feedstock repo: probe + parse the registry YAML into
     `PayloadRow`s. The registry is an L3 mirror; map defensively: read
     `name`, per-version entries with `entrypoints`/`runtime_requirement`/
     artifact `url`/`sha256` where present; unknown keys are ignored,
     missing ones become `null`. Record per-repo ok/fail in `sources`.
   - Product: latest 5 releases of tamatebako/tebako; per release find
     `tebako-bootstrap-<triplet>` assets; record `size` in bytes.
   - Retry policy from the charter (3 retries, 5/15/45 s, then build fails).
   - Writes `src/data/versions.json` (schema below) and prints a one-line
     summary per plane (`runtimes: 42 rows (ruby 30, python 12) · payloads:
     6 · toolchain: 5`).
5. **Build wiring**: `package.json` scripts — `"collect":
   "node tools/collect.ts"`, `"prebuild": "npm run collect"`, `"build":
   "astro build"`. Offline dev: `VERSIONS_OFFLINE=1 npm run build` reads the
   committed `fixtures/versions.sample.json` instead (author it by hand,
   clearly marked sample, ~6 rows) — never fail layout dev on network.
6. **CI** `.github/workflows/ci.yml`: on push/PR — setup-node, `npm ci`,
   `npm run build` (with `GITHUB_TOKEN` env = `${{ secrets.GITHUB_TOKEN }}`),
   plus a `--offline` fixture build leg so layout regressions are caught
   without network.

## `versions.json` schema (implement as a TS type in `src/lib/types.ts`)

```ts
interface VersionsData {
  generated_at: string;                 // ISO-8601 build clock
  sources: { url: string; kind: 'factory-release'|'registry'|'product-release'|'checksum';
             ok: boolean; note?: string }[];
  runtimes: {
    engine: string;                     // 'ruby' | 'python' | …
    lang_version: string;               // '3.3.12'
    flavor: string | null;              // 'jit' | null
    tebako_line: string;                // '0.16.22'
    triplet: string;                    // 'macos-arm64'
    reference: string;                  // 'ruby@3.3.12;tebako=0.16.22;image'
    latest_in_line: boolean;
    exe:   { url: string; size: number; downloads: number; sha256: string | null };
    image: { url: string; size: number; downloads: number; sha256: string | null };
    release: { tag: string; url: string; published_at: string; prerelease: boolean };
  }[];
  payloads: {
    name: string;
    registry_repo: string;              // 'tebako-packages/xml2rfc'
    registry_url: string;
    versions: { version: string; entrypoints: string[];
                runtime_requirement: string | null; platforms: string[];
                artifact_url: string | null; sha256: string | null }[];
  }[];
  toolchain: { version: string; url: string; published_at: string;
               bootstrap: { triplet: string; bytes: number }[] }[];
}
```

## Acceptance

- `npm run build` exits 0 against the LIVE network and the summary line
  shows the charter's sanity expectations (ruby 3.3.7/3.3.12 rows, python
  4 lines × 6 triplets, metanorma + xml2rfc payload rows, tebako 2.3.x
  toolchain rows with bootstrap bytes < 3145728).
- `VERSIONS_OFFLINE=1 npm run build` exits 0 with zero network.
- `src/data/versions.json` validates against the TS type (a runtime check
  in the collector — hand-rolled asserts, no new dep).
- CI workflow green on the PR.

## Non-goals

No page design (plan 02). No per-asset manifest.json fan-out (plan 04).
No deploy (plan 03). No capability derivation in the collector — plan 02
derives at render time so the rule lives next to its citation.
