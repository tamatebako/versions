# 04 — factory capabilities flow (kill the derived chips)

**Goal:** the site's capability chips FLOW from the factories' published
manifests instead of being derived on the site (spec 00 invariant 10: a
contract value has ONE owner; capability truth is owned by the factory that
compiled the runtime).

**Depends on:** nothing (parallel with 01–03). **Blocks:** nothing (the
site works without it — derived chips carry a "derived" marker until this
lands).

## Design

Each factory's per-runtime `….manifest.json` gains an ADDITIVE key:

```yaml
capabilities: [yjit]        # ruby POSIX legs of lang >= 3.2; omitted/empty on windows-ucrt64
```

- **Owner of truth**: the factory builder — it KNOWS (it ran configure with
  the pinned rustc and it runs BootSmoke's `yjit` scenario). The manifest is
  generated at build time; add the key where the manifest is emitted.
- **tebako-runtime-ruby**: emit `capabilities:` from the builder at the same
  place `contract_version`/`image` are written; source the value from the
  SAME logic as `BootSmoke#derived_yjit_state`
  (`build/lib/tebako_runtime_builder/boot_smoke.rb`) — ideally extract the
  derivation into one method both the manifest writer and the smoke call
  (DRY; do not copy-paste the rule). Boot smoke gains an assertion:
  manifest capabilities ⇔ derived state (parity, not duplication).
  Forward-looking: when the ruby-4 image-era line ships with ZJIT
  (tebako-runtime-ruby#147), `zjit` joins the list the same way.
- **tebako-runtime-python**: same shape; `capabilities: [jit]` on the jit
  flavor lines (flavor PR in flight in the orchestrating session —
  COORDINATE: if that PR is still open, propose the key rides it;
  otherwise a follow-up PR). Non-jit lines emit `capabilities: []` (or omit).
- **Schema**: the factory repo's manifest JSON schema gets the optional key
  (additive; old readers ignore it — v1-reader compatibility law).
- **Site collector change** (this repo, after a factory release carrying
  the key exists): for `latest_in_line` rows only, fetch the per-runtime
  `….manifest.json` asset (bounded: one request per (line × triplet) of the
  latest release — ruby ~7, python ~24; well within rate limits); when
  `capabilities` is present it WINS and the chip renders solid; absent →
  the plan-02 derivation runs and the chip renders with a dotted outline +
  "derived" tooltip. Legend line under the runtimes table explains both.
  The derive code STAYS as the pre-key fallback — note in its comment that
  it is a fallback, not the authority.

## Steps

1. tebako-runtime-ruby PR (draft): manifest writer + schema + boot-smoke
   parity assertion + a spec note in the repo's docs. Acceptance: CI
   builds one leg whose published manifest shows `capabilities: [yjit]`
   (macos) and one showing none (windows-ucrt64) — cite the run ids.
2. tebako-runtime-python PR (draft): same, `[jit]` on jit lines.
3. After BOTH factories have a published release with the key: this repo's
   collector PR (manifest fetch + win/fallback + chip styling + legend).
4. Update tebako.org#91's follow-up note to done.

## Acceptance

- A released ruby manifest and python manifest on GitHub carry the key
  (curl the assets, quote them in the PR).
- The site renders flowed chips (solid) for those runtimes and derived
  chips (dotted) elsewhere; the legend explains the difference.
- No derivation text on the site claims authority — the footer line stays.

## Non-goals

No backfill of OLD releases (their chips stay derived — correct: the key
didn't exist). No change to runtime resolution semantics; the manifest key
is display metadata, not a selector axis (ability ≠ selector axis — spec 28
§8's precedent).
