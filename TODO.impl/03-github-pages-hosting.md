# 03 — GitHub Pages hosting at www.tebako.org/versions

**Goal:** the built site is live at `https://www.tebako.org/versions/`.

**Depends on:** 01, 02. **Blocks:** 05.

## Step 0 — verify the main site's Pages mechanics FIRST (decides the path)

Run and record the answers in the PR body:

```bash
gh api repos/tamatebako/tebako.org/pages
gh api repos/tamatebako/tamatebako.github.io/pages 2>&1 | head -5
ls tebako.org/.github/workflows/   # how does the main site deploy?
ls tebako.org/CNAME 2>/dev/null; cat tebako.org/CNAME 2>/dev/null
```

- If `tamatebako/tamatebako.github.io` exists as the org Pages repo AND
  carries the `www.tebako.org` CNAME → **path A**.
- If tebako.org is a project-Pages site with the custom domain attached to
  it directly → **path B**.
- If neither matches, STOP and ask the owner (do not improvise a third
  hosting shape).

## Path A — org-pages subpath (preferred when available)

GitHub serves an org's project Pages at `<org-custom-domain>/<repo>/` when
the org's Pages site carries the custom domain. Then:

1. The GitHub repo for THIS project MUST be named exactly `versions`
   (`tamatebako/versions`) — the repo name becomes the URL path.
2. Repo settings → Pages → source: GitHub Actions.
3. `.github/workflows/deploy.yml` in THIS repo: on push to main +
   `schedule: 17 4 * * *` (daily, odd minute) + `workflow_dispatch`:
   setup-node → `npm ci` → `npm run build` (env `GITHUB_TOKEN`) →
   `actions/upload-pages-artifact` (path `dist`) →
   `actions/deploy-pages`. Standard Astro-on-Pages shape; `permissions:
   pages: write, id-token: write`; `environment: github-pages`.
4. `astro.config.mjs` already has `base: '/versions'` (plan 01) — verify
   asset URLs render with the `/versions/` prefix in the built HTML.
5. Repo creation + Pages enablement may exceed the CI token's rights —
   flag to the owner as a manual step with the exact clicks/commands.

## Path B — assemble into the main site's deploy

If the main site's Pages IS the tebako.org repo deploy:

1. THIS repo gets `.github/workflows/build.yml`: on push to main + daily
   `schedule: 41 4 * * *` + `workflow_dispatch` — builds and uploads a
   workflow artifact named `site-dist` (path `dist`,
   `retention-days: 7`). No Pages on this repo.
2. tebako.org repo (SEPARATE PR, one-open-PR rule, DRAFT until owner
   go-ahead — this touches production): its deploy workflow gains, BEFORE
   `upload-pages-artifact`:
   - download the latest successful `site-dist` artifact from
     `tamatebako/versions`' build.yml:
     `gh run download --repo tamatebako/versions --name site-dist --dir
     dl/versions` of the latest `conclusion=success` run on the default
     branch (`gh run list --repo tamatebako/versions --workflow build.yml
     --branch main --status success --limit 1 --json databaseId -q
     '.[0].databaseId'` → `gh run download <id> --repo …`).
     The main site's deploy job needs `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`
     PLUS cross-repo read — if the default token cannot read the other
     repo's artifacts, that is the SAME fine-grained PAT the owner is
     already creating for py-factory#5; secret name proposal:
     `TEBAKO_PACKAGES_RO_PAT`. Do not invent a second secret.
   - `cp -R dl/versions/ dist/versions/` then deploy as today.
   - The main site's daily cron (add `schedule: 23 4 * * *` to its deploy
     workflow if not present) is what refreshes /versions — later replaced
     by plan 05's dispatch.
3. Regression guard in that PR: after assembly, `test -f
   dist/index.html && test -f dist/versions/index.html` — both must exist
   before upload.

## Acceptance (either path)

- `curl -sI https://www.tebako.org/versions` → 200.
- `curl -s https://www.tebako.org/versions | grep -c tebako-runtime` ≥ 10.
- `curl -sI https://www.tebako.org/` still 200 (main site unaffected).
- A second deploy (push a whitespace commit) refreshes content — the
  pipeline is not a one-shot.
- robots/404: `/versions/404.html` exists; the page has
  `<meta name="robots" content="index,follow">`.

## Rollback

Path A: repo settings → Pages → disable (the subpath 404s; main site
untouched). Path B: revert the tebako.org workflow PR. Write the rollback
one-liner into the PR body.

## Non-goals

No custom domain, no CDN tuning, no cache headers beyond Pages defaults
(revisit if staleness complaints appear — the daily cron bounds staleness
at ~24 h, which matches the registry cache TTL convention in spec 07).
