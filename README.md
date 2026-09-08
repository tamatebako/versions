# tebako versions

Static, read-only catalog of the tebako ecosystem's published artifacts,
built at build time from three public data planes and served at
<https://www.tebako.org/versions> via GitHub Pages.

- **Runtimes** — factory releases (`tamatebako/tebako-runtime-ruby`,
  `tamatebako/tebako-runtime-python`)
- **Payloads** — feedstock registries (`tpkg-registry.yaml`) in the
  `tebako-packages` org
- **Toolchain** — `tamatebako/tebako` product releases (per-triplet
  bootstrap sizes against the 3 MiB gate)

The site never re-authors a contract value: everything rendered is fetched
from a published source or derived with the rule shown on the page.

## Commands

| Command | Action |
| :-- | :-- |
| `npm run collect` | Fetch all data planes into `src/data/versions.json` |
| `npm run build` | Collect (live network) + build the static site into `dist/` |
| `VERSIONS_OFFLINE=1 npm run build` | Build from `fixtures/versions.sample.json`, zero network |
| `npm run dev` | Local dev server |

Sources are declared in `sources.yaml`. A source that fails after retries
(3×, 5/15/45 s backoff) fails the build loudly — a half-catalog is never
deployed.

The execution contract lives in `TODO.impl/` (plans 00–05).
