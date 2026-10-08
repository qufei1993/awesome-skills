# Generated Catalog Data

[Chinese version](format.zh.md)

Contributors submit collection READMEs and optional covers. CI generates website JSON. See [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Inputs and generation

`README.md` is English; `README.zh.md` is Chinese. Keep each file in one language and update existing translations together. Title, summary, overview, scenarios, usage, source, and optional cover come from these files. The directory provides the category. Collection input includes its READMEs and local cover.

CI resolves the README's GitHub Skill links:

- A `SKILL.md` file link includes that one Skill.
- A directory or repository link recursively includes all contained `SKILL.md` files.
- Each source resolves to a fixed commit. Skill descriptions come unchanged from upstream; installation directories and license evidence come from the same commit.

Generated JSON is a build artifact under `dist/`. Directory links define which Skills the collection includes. The detailed data contract is in [site-contract.mjs](../../scripts/lib/site-contract.mjs).

## Stable data

The first generation creates stable identities and an initial revision. The previous production snapshot is the baseline for subsequent generation. Unchanged collection input reuses its recorded source commits. Changed input is resolved again; stable identities and version history are retained. Trusted CI reads `current.json` and its snapshot from the R2 public data root set in `CATALOG_DATA_BASE_URL`. Local builds use available cached data or an explicit baseline.

## Review and verification

PR CI checks the format, resolves upstream data, and builds a preview. New records stay pending in this preview.

The trusted `main` publication workflow uses `--reviewed-main` and verifies the actual merged PR through GitHub before marking its generated content approved.

Record verification states from actual evidence. Unknown licenses use `NOASSERTION`; resources awaiting review use `needs-review`; installation and workflow awaiting tests use `not-tested`. Record image attribution and rights evidence from their sources. Failed installation or workflow results block production.

## Commands

`npm run validate` checks README format offline. `npm run validate -- --resolve-upstream` also resolves linked sources. `npm run build`, `npm run build:preview`, and `npm run dev:site` resolve upstream data automatically. `npm run check` needs network access during its preview build.

Covers are optional. Local covers enter the snapshot; HTTPS covers stay direct links. See [deployment](deployment.md) for website preview, publication, and rollback.
