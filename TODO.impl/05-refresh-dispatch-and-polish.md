# 05 — refresh triggers and polish

**Goal:** the catalog refreshes within minutes of a factory release (not
just on the daily cron), plus the small polish items.

**Depends on:** 03. **Blocks:** nothing.

## 1. repository_dispatch from the factories

- The versions repo's deploy/build workflow gains
  `on: repository_dispatch: types: [runtime-published, payload-published]`.
- Factory release workflows (tebako-runtime-ruby `publish.yml`,
  tebako-runtime-python `publish.yml`; later any feedstock publish) gain a
  final, non-blocking step:

  ```yaml
  - name: Ping the versions catalog
    if: always() && success()
    run: gh api repos/tamatebako/versions/dispatches -f event_type=runtime-published
    env:
      GH_TOKEN: ${{ secrets.TEBAKO_PACKAGES_RO_PAT }}
  ```

- **Manual dependency (owner)**: that PAT is the same fine-grained PAT as
  the py-factory#5 item (contents/actions read on tebako.org +
  tamatebako/versions). If the PAT does not exist yet, land the step with
  `continue-on-error: true` and a comment, and note it in the PR body.
- Each factory change is its own PR (one-open-PR-per-repo, draft until
  green).

## 2. Test the dispatch end-to-end

```bash
gh api repos/tamatebako/versions/dispatches -f event_type=runtime-published
# then: gh run list --repo tamatebako/versions --limit 1 — a run appears
```

Record the run id in the PR.

## 3. Badges (static, no server)

Under each table, a copyable shields.io markdown snippet using the static
badge endpoint, e.g. latest ruby runtime:
`https://img.shields.io/badge/tebako%20runtime-ruby%203.3.12%20%C2%B7%200.16.22-blue`
generated from the data at build time. No dynamic badge service (the
no-default-service law; shields dynamic endpoints would re-introduce one —
static only).

## 4. RSS/atom for new versions

`src/pages/versions.xml.ts` mirroring tebako.org's existing `rss.xml.ts`
pattern (read it first): one entry per newly-seen (engine, lang_version,
tebako_line) at build time. Since the site is stateless across builds, the
feed lists the CURRENT latest-per-line set with `pubDate` =
release.published_at — honest framing: "current catalog snapshot", not an
event log.

## 5. Deferred-by-default (only if trivial)

Per-engine sub-pages (`/versions/ruby`) once a table exceeds ~50 rows —
Astro static paths from the same data. Skip otherwise; note in the PR why.

## Acceptance

- Dispatch test shows a triggered run (run id cited).
- Badge markdown pasted into a comment renders (attach screenshot).
- `curl -s https://www.tebako.org/versions/versions.xml | head` is valid
  XML with the current latest rows.
- Daily cron still green (the dispatch path is additive, never replacing
  the cron — cron is the reconciliation backstop).

## Non-goals

No webhooks service, no database of historical rows, no auth, no analytics
beyond what GitHub Pages provides. No removal of the daily cron.
