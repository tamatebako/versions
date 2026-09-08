# 02 — the catalog page

**Goal:** render `versions.json` as the public catalog at `/versions/`.

**Depends on:** 01. **Blocks:** 03.

## Design

One route, `src/pages/index.astro` (Astro `base: '/versions'` serves it at
`/versions/`). Fully static; tables render with JS disabled. Vanilla-JS
progressive enhancement only (no new frameworks, no hydration islands).

Visual identity: match tebako.org's look WITHOUT importing its internals —
copy the small set of design tokens (fonts, brand colors, spacing) into
`src/styles/tokens.css` with a header comment "visual parity with
tebako.org; update by hand when the main site's tokens change". (Visual
tokens are not contract values; invariant 10 does not apply, but the
comment keeps the sync honest.)

## Sections (in order)

1. **Header**: "tebako versions" + one-line what-this-is + build timestamp
   (`generated_at`) + link back to tebako.org.
2. **Runtimes table** — one row per (engine, lang_version, flavor,
   tebako_line, triplet) for `latest_in_line` rows, with a "show all
   releases" expander for the rest. Columns:
   - engine · lang version (+ flavor chip, e.g. `jit`)
   - tebako line (`0.16.22`)
   - platform chip (triplet)
   - **capabilities chips** — derived at RENDER time by
     `src/lib/capabilities.ts`, with the rule in a code comment + a `?`
     tooltip linking the owning source:
     - ruby: `yjit` when lang_version >= 3.2 AND triplet != windows-ucrt64
       (rule owner: tebako-runtime-ruby
       `build/lib/tebako_runtime_builder/boot_smoke.rb`
       `derived_yjit_state`; windows excluded — upstream CRuby lacks
       mingw-x64 YJIT). ruby >= 4.0 additionally gets `zjit-proto` ONLY
       when the manifest flows it (plan 04) — never derived in v1.
     - python: `jit` when flavor == 'jit'.
     - other engines: none.
   - exe + image sizes (MiB, 1 decimal) and downloads (exe.downloads)
   - age (`published_at`, relative: "3 days ago")
   - **pin snippet** (see below)
   - sha256 of exe (truncated 12 chars, full in title tooltip) — `—` when
     null (older releases; never guess).
3. **Payloads table** — one row per payload (latest version), versions
   expander for older ones. Columns: name · latest version · version count
   · entrypoints (count + tooltip list) · runtime requirement · platforms
   · registry link (`registry_url`) · pin snippet.
4. **Toolchain table** — tebako product versions: version · age · per-triplet
   bootstrap size chips with a green/red tint against the 3 MiB gate
   (3145728 bytes — the constant lives ONCE in `src/lib/gates.ts` with a
   comment citing spec 00 invariant 2).
5. **Footer** — "Rendered from:" with every `sources[]` URL (ok ones),
   the explicit line: "This page is a read-only rendering. Canonical
   resolution lives in the published registries and factory releases
   (tebako spec 00, invariant 10).", plus the build timestamp.

## Pin snippets (the feature)

`src/components/PinSnippet.astro` — copyable mono block + copy button
(`navigator.clipboard`, fallback: select-on-click). Per row type:

- **Runtime row**, two forms stacked:
  - reference: `ruby@3.3.12;tebako=0.16.22;image`
  - config: three yaml lines a user pastes into `~/.tebako/config.yaml`:
    ```yaml
    runtimes:
      ruby: { version: 3.3.12, tebako: 0.16.22 }
    ```
- **Payload row**, two forms:
  - env: `TEBAKO_<TOOL>_VERSION=<version>` — `<TOOL>` = entrypoint name
    uppercased with non-alphanumerics → `_` (VERIFIED examples:
    `metanorma-tr` → `TEBAKO_METANORMA_TR_VERSION`; `rbprobe-mri` →
    `TEBAKO_RBPROBE_MRI_VERSION`). Use the FIRST entrypoint for the env
    name; tooltip lists the others.
  - verb: `tebako-shim use <tool> <version>` (the user-default pin verb,
    shipped in tebako v2.3.0+).

## Filter

A single text input filtering all three tables client-side (vanilla JS,
`data-filter` attributes on rows; `<noscript>` hides the input). Match
against engine, versions, triplet, entrypoints.

## Acceptance

- `npm run build` output HTML at `dist/index.html` contains the sanity
  rows from the charter (grep for `3.3.12`, `0.16.22`, `metanorma`,
  `TEBAKO_METANORMA_VERSION`, `tebako-shim use`).
- Page works with JS disabled (tables fully rendered in HTML).
- Copy button verified once by hand (`npm run dev`) — note it in the PR.
- Total page weight (HTML+CSS+JS, excluding nothing) < 150 KB.
- Screenshots (light page top + each table) attached to the PR body.

## Non-goals

No per-engine sub-pages, no RSS, no badges (plan 05). No search backend.
No dark-mode toggle beyond `prefers-color-scheme` media queries if the
tokens already support it — do not build new theming.
