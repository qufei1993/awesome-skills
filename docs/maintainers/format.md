# Generated Catalog Data

[Chinese version](format.zh.md)

Contributors submit collection READMEs and optional covers. CI generates website JSON. See [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Inputs and generation

`README.md` is English; `README.zh.md` is Chinese. Keep each file in one language and update existing translations together. Title, summary, overview, scenarios, usage, source, and optional cover come from these files. The directory provides the category. Collection input includes its READMEs and local cover.

CI resolves the README's GitHub Skill links:

- A `SKILL.md` file link includes that one Skill.
- A directory or repository link finds Skill directories. A directory containing `SKILL.md` provides one entry and keeps its nested files as supporting resources. Explicit file links can include nested Skills separately.
- Each source resolves to a fixed commit. Skill descriptions come unchanged from upstream; installation directories and license evidence come from the same commit.

Name and description require author-provided values. Metadata reading normalizes missing quotes around unambiguous text fields while preserving their text. Display names are separate from installation directory names; installation names remain safe across platforms and distinguish different source directories.

Generation keeps shallow Git source caches under `dist/upstream-repositories/`. It reads complete trees and Skill files from fixed commits and verifies their Git hashes. Later builds reuse these caches.

Generated JSON is a build artifact under `dist/`. Directory links define which Skills the collection includes. The detailed data contract is in [site-contract.mjs](../../scripts/lib/site-contract.mjs).

Website builds sort collections by their single source repository's GitHub Star count, highest first. Star counts are refreshed during builds after a 24-hour cache period. A failed refresh keeps the last known count. Collections with multiple source repositories use a stable fallback order. Sorting updates only the index order and preserves recorded Skill content and collection revisions. Local builds use the GitHub CLI (`gh`) to read public repository metadata; CI uses its existing GitHub token.

## Stable data

The first generation creates stable identities and an initial revision. The previous production snapshot is the baseline for subsequent generation. Unchanged collection input and generation rules reuse recorded source commits. Changed input or generation rules are resolved again; stable identities and version history are retained. Trusted CI reads `current.json` and its snapshot from the published data address set in `CATALOG_DATA_BASE_URL`. Local builds use available cached data or an explicit baseline.

## Review and verification

PR CI checks the format, resolves upstream data, and builds a preview. New records stay pending in this preview.

The trusted `main` publication workflow uses `--reviewed-main` and verifies the actual merged PR through GitHub before marking its generated content approved.

Record verification states from actual evidence. Unknown licenses use `NOASSERTION`; resources awaiting review use `needs-review`; installation and workflow awaiting tests use `not-tested`. Record image attribution and rights evidence from their sources. Failed installation or workflow results block production.

## Commands

`npm run validate` checks README format offline. `npm run validate -- --resolve-upstream` also resolves linked sources. `npm run build`, `npm run build:preview`, and `npm run dev:site` resolve upstream data automatically. `npm run check` needs network access during its preview build.

Covers are optional. Local covers enter the snapshot; HTTPS covers stay direct links. See [deployment](deployment.md) for website preview and publication.
