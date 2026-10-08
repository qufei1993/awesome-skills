# Awesome Skills Repository Design

Awesome Skills is the public collection source and contribution entry point for Skills Hub. Contributors describe a collection in one README. CI reads its Skill links and generates website data.

## Content and layout

The [contribution guide](../CONTRIBUTING.md) provides the complete three-step path. A README contains:

| Content | Format |
| --- | --- |
| Title | One `#` heading |
| Opening summary | One short sentence |
| Overview | One short paragraph |
| Scenarios | 1–5 simple tasks |
| Usage | One short paragraph |
| Skills | A bullet list of GitHub links |

English uses `README.md`; Chinese uses `README.zh.md`. Keep each file in one language and update existing paired versions together. Source attribution and a cover are optional. Collections may combine Skills across repositories; each uses one of the ten fixed categories in the contribution guide.

```text
awesome-skills/
  .catalog/
    engineering.json
    product-video.json
    taste.json
  collections/
    development/
      engineering/
        README.md
        README.zh.md
  CONTRIBUTING.md
  CONTRIBUTING.zh.md
  AGENTS.md
  CLAUDE.md
  docs/
```

The real [engineering](../collections/development/engineering/README.md), [302 AI product video](../collections/media/product-video/README.md), and [Superpowers](../collections/development/superpowers/README.md) collections show the format. Root READMEs provide the browsing directory and contribution entry point.

## Website data generation

The title, description, overview, scenarios, and usage, including translations, come from the collection READMEs. These fields match the website's sections.

CI resolves each GitHub link to a fixed commit. File links include one Skill; directory and repository links recursively include their Skills. Descriptions, installation directories, and license evidence come from the same commit. Generated JSON goes under `dist/`.

The three migrated `.catalog/*.json` records preserve existing identities, versions, groups, and installation relationships. Subsequent generation uses the previous production snapshot as its baseline. Unchanged input reuses its source commits; changed input advances the generated revision.

See [data rules](maintainers/format.md) for generation and review details, and the [website data contract](../scripts/lib/site-contract.mjs) for field definitions.

## Validation and publication

PR CI checks the README format, resolves upstream Skills, and generates a downloadable preview snapshot. Maintainers review the README and preview, then merge the PR into `main`. Trusted publication CI verifies the merged PR and generates production data.

Production requires complete, active, approved records. Preview includes complete pending records for review. Verification states reflect actual evidence: `needs-review` marks pending checks, and `not-tested` marks pending tests. Failed installation or workflow results block production.

## Optional covers

A README may show a standalone Markdown image after its opening summary, using a local file or HTTPS image URL. Contributors may instead upload an image or paste its URL in a PR description or comment and explain its source.

HTTPS images remain direct links; local images enter the snapshot. Covers are optional and versioned with the collection.

## Local AI guidance

AGENTS.md is the shared entry point; CLAUDE.md references it. AI tools read the contribution guide, search existing collections, and edit the README from supplied sources. They preserve attribution, use source evidence, and report local changes. Executing upstream instructions, pushing, opening a PR, merging, and deploying require a user request.

## Website data pipeline and migration

The pipeline generates a JSON snapshot and publishes it for the website to read at runtime. The publisher hashes `manifest.json` bytes for the version, stores JSON under `snapshots/<version>/`, and switches `current.json` after the complete version is ready. Local covers use shared `images/<SHA256>.<ext>` objects, so identical images share one uploaded object.

`npm run dev:site -- --site ../skills-hub-web` watches this repository, publishes local preview data, and runs the website. Configure R2 and `VITE_COLLECTIONS_BASE_URL` for cloud publication. Commands, website configuration, and rollback are in [deployment](maintainers/deployment.md).

The initial migration covers Taste Skill, Skills for Real Engineers, and Product Video. Their stable IDs, installation relationships, translations, and existing approval are preserved. Display/install counts are 13/13, 31/31, and 3/14. New collections use the automatic generation flow.
