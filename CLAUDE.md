# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

**tebako versions** — a static, read-only catalog of the tebako ecosystem's
published artifacts, styled after mise-versions.jdx.dev, hosted at
https://www.tebako.org/versions via GitHub Pages. The GitHub remote must be
`tamatebako/versions` (repo name = URL path).

Plans 01–05 are EXECUTED, merged, and live (see git log). `TODO.impl/00-charter.md`
remains the owner-locked decision log. Post-contract owner amendments, in order:
detail pages per line/payload with kind groups (supersedes plan 05 §5's ~50-row
deferral); spec 33 runtime feedstocks adopted via discovery; config is SSOT-clean
(zero ecosystem state).

This repo lives inside the tebako ecosystem — read `../CLAUDE.md` (the
ecosystem map) for the five laws and repo table. The relevant ones here:
no-default-service, SSOT (spec 00 invariant 10), and the < 3 MiB bootstrap
gate (spec 00 invariant 2). This repo itself is plain TypeScript/Astro — no
C, no Rust, no runtime services.

## Commands

Created by plan 01 (none exist before it lands):

```bash
npm run collect                    # run tools/collect.ts → src/data/versions.json (generated, gitignored)
npm run build                      # prebuild runs collect, then astro build
VERSIONS_OFFLINE=1 npm run build   # build from fixtures/versions.sample.json — zero network
npm run dev                        # local dev server
```

CI (`.github/workflows/ci.yml`) runs both an online and an offline fixture
build leg; local dev never needs network (the local network has an
intermittent captive portal — see retry law below).

## Architecture

Module map (who owns what):

- `tools/lib/` — the collector's pure, test-covered modules: `grammar.ts` (asset-name grammars), `registry.ts` (feedstock registry → rows, index-catalog harvest, SHA256SUMS parse), `validate.ts` (schema checks). `tools/collect.ts` keeps the network plane collection and imports these.
- `src/lib/` — the site's model: `groups.ts` (line/payload catalog model — the index and detail pages consume it), `format.ts` (display derivations: mib/relAge/envName/badge), `capabilities.ts` (chip derivation fallback), `gates.ts` (3 MiB gate), `data.ts` (`loadVersions()` — the only versions.json import), `paths.ts` (static-route computation for detail pages), `types.ts` (the VersionsData schema).
- `src/styles/` — `tokens.css` (tebako.org parity tokens) then `base.css` (shared scaffold/table/chip language); pages carry only page-specific rules.
- `src/layouts/BasePage.astro` — the document scaffold (fonts, meta, favicon) for every page.
- `src/components/PinSnippet.astro` — pin blocks + the copy behavior (works on every page that renders it).
- Tests: `npm test` (node:test, stdlib only) — pure modules' interface is the test surface; wired into CI.

## Architecture

One static Astro site (`output: 'static'`, `site: https://www.tebako.org`,
`base: '/versions'`, TypeScript strict). No server, no runtime JSON API, no
database. Build-time pipeline only:

```
GitHub releases API (factory repos)      ┐
tpkg-registry.yaml (feedstock repos)     ├─ tools/collect.ts → src/data/versions.json → src/pages/index.astro
tamatebako/tebako releases (product)     ┘
```

The three data planes:

1. **Factory releases** — every `tebako-runtime-<engine>` repo in the
   `tamatebako` org, DISCOVERED (a new runtime repo is adopted by the next
   build; no config change). Asset grammar:
   `tebako-runtime-<tebakoVer>-<langVer>[-<flavor>]-<triplet>` + suffix
   (none = exe, `.exe`, `.tfs` env image, `.manifest.json` shard,
   `…-universal.tfs` = spec 33 universal image paired into every triplet).
   langVers carry as many dotted segments as the language spells
   (`10.1.1.0`). The triplet vocabulary is ELABORATED from the release
   asset names themselves (`deriveTriplets` — the monolithic manifest.json
   is legacy, never read); unparsable runtime names are counted and
   surfaced, never silently dropped. sources.yaml holds no ecosystem
   state — only subject pointers (orgs + the product repo).
2. **Feedstock registries** — `tpkg-registry.yaml` at the root of every
   repo in the `tebako-packages` org (L3 mirror). Read defensively: unknown
   keys ignored, missing ones → `null`. Repos without the file are skipped
   (counted in the report, not an error). The site reads, never writes.
3. **Product releases** — `tamatebako/tebako`: latest 5 releases, per-triplet
   `tebako-bootstrap-<triplet>` asset sizes, rendered against the 3 MiB gate
   (constant `3145728` lives ONCE in `src/lib/gates.ts`, citing spec 00
   invariant 2).

Key files: data schema `src/lib/types.ts` (`VersionsData` — runtime-checked
by the collector with hand-rolled asserts) · capability derivation
`src/lib/capabilities.ts` · pin snippets `src/components/PinSnippet.astro`
· authored config `sources.yaml` at repo root · design tokens copied by
hand into `src/styles/tokens.css` (visual parity with tebako.org — not a
contract value).

Capability chips are derived at render time **as a fallback only** (ruby
`yjit`: non-windows AND ruby >= 3.2 OR the 3.1 line on x86_64 — mirroring
the factory's `Capabilities` truth table; python `jit`: the flavor) —
plan 04's factory `capabilities:` manifest key WINS when present (solid
vs dotted chip; collector fetches shards for latest-in-line rows). The
derive code keeps its fallback comment. Other engines (jruby,
truffleruby, openjdk) derive nothing until their manifests carry keys.

## Laws for every change in this repo

- **Read-only rendering / SSOT**: the site NEVER re-authors a contract
  value. Everything rendered is fetched from a published source, or derived
  with the rule shown on the page + a link to its owning source.
- **Named failures, no partial data**: a source that fails after retries
  fails the BUILD LOUDLY. A stale-looking half-catalog is worse than a
  failed deploy; the previous deploy stays live.
- **Network retries**: 3 retries, 5/15/45 s backoff on 403-rate-limit /
  5xx / TLS / DNS, then fail.
- **Never guess sha256**: rows without a fetched checksum get
  `sha256: null`, rendered as `—`.
- **YAML for authored config** (`sources.yaml`); JSON only for generated
  data (`src/data/versions.json`, `fixtures/versions.sample.json`).
- **No JS-required rendering**: tables fully render in static HTML;
  filter/copy are vanilla-JS progressive enhancement only. No frameworks,
  no hydration islands.
- **No new services**: no dynamic badge endpoints, no search backend, no
  analytics. Shields.io static badges only.
- **Bounded, authenticated GitHub API use**: always send
  `Authorization: Bearer $GITHUB_TOKEN` when set (unauthenticated is
  60 req/h). Requests: org rosters (factory + feedstock discovery), one
  releases list per factory, one checksum fetch per latest release per
  line, one registry raw file per feedstock, and the plan-04 per-shard
  manifest fetch for latest-in-line rows (small CDN downloads,
  concurrency 6).
- **Page budget**: total page weight (HTML+CSS+JS) < 150 KB (plan 02
  acceptance).

## Process (from the charter)

- Commits: `GIT_EDITOR=true git -c user.name=tebako-ci -c
  user.email=tebako@ribose.com commit`.
- PR bodies via `--body-file` only — inline `--body` with backticks
  executes them as shell substitution.
- One open PR at a time; draft until CI green. Merges to main of THIS repo
  are fine once green. Production touches (tebako.org-side workflow
  changes, Pages enablement) stay draft until the owner's go-ahead.
- Plan 03's hosting path (A: org-pages subpath vs B: assemble into
  tebako.org's deploy) is decided by its step-0 verification of the main
  site's Pages config — if neither matches, STOP and ask the owner.
- First real build must hit the charter's sanity expectations (ruby
  3.3.7/3.3.12 on 0.16.x incl. windows-ucrt64; python 3.11.16 / 3.12.14 /
  3.13.15 / 3.14.7 × 6 POSIX triplets, no windows row; payloads include
  metanorma and xml2rfc; tebako 2.3.x with bootstrap bytes < 3145728). If
  the build disagrees, the collector is wrong, not the ecosystem.
