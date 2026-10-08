# Generated Catalog Data

[Chinese version](format.zh.md)

Contributors submit collection READMEs and optional covers. CI generates website JSON; contributors and maintainers do not create a JSON file for each new collection. See [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Inputs and generation

`README.md` is English; `README.zh.md` is Chinese. Keep each file in one language and update existing translations together. Title, summary, overview, scenarios, usage, source, and optional cover come from these files. The directory provides the category.

CI resolves the README's GitHub Skill links:

- A `SKILL.md` file link includes that one Skill.
- A directory or repository link recursively includes all contained `SKILL.md` files.
- Each source resolves to a fixed commit. Skill descriptions come unchanged from upstream; installation directories and license evidence come from the same commit.

Generated JSON goes under `dist/`, outside version control. The detailed data contract remains in [site-contract.mjs](../../scripts/lib/site-contract.mjs). Directory links define inclusion scope, not website groups or dependency bundles.

## Stable data

The three migrated `.catalog/*.json` records preserve existing identities, versions, groups, and bundle installation relationships. They are compatibility inputs, not a template for new submissions.

The previous production snapshot is the baseline for subsequent generation. Unchanged README input reuses its recorded source commits. Changed input is resolved again; stable identities and version history are retained. This prevents an unrelated PR from silently updating upstream Skills. Trusted CI loads the previous Release snapshot with `CATALOG_USE_RELEASE_BASELINE=1`; local builds use available cached data or an explicit baseline.

## Review and verification

PR CI checks the format, resolves upstream data, and builds a preview. New records stay pending in this preview. Passing checks does not approve publication.

The trusted `main` publication workflow uses `--reviewed-main` and verifies the actual merged PR through GitHub before marking its generated content approved. Existing approved migration records retain their approval. Local previews do not grant approval.

Reading source files does not test installation or usage. Unknown licenses remain `NOASSERTION`; resource checks remain `needs-review`; installation and workflow results remain `not-tested` until real tests establish otherwise. Preserve actual image attribution and rights evidence. Failed installation or workflow results block production.

## Commands

`npm run validate` checks README format without network access. `npm run validate -- --resolve-upstream` also resolves linked sources. `npm run build`, `npm run build:preview`, and `npm run dev:site` resolve upstream data automatically. Therefore, `npm run check` needs network access during its preview build.

Covers are optional. Local covers enter the snapshot; HTTPS covers stay direct links and are not downloaded. See [deployment](deployment.md) for website preview, publication, and rollback.
