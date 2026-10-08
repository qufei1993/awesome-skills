# Awesome Skills Repository Design

Awesome Skills is the public collection source and contribution entry point for Skills Hub. Contributors describe a collection in one README. Existing website installation and review data remains in versioned internal system files.

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
        cover.png
  CONTRIBUTING.md
  CONTRIBUTING.zh.md
  AGENTS.md
  CLAUDE.md
  docs/
```

The real [engineering](../collections/development/engineering/README.md) and [302 AI product video](../collections/media/product-video/README.md) collections show the readable format. Root READMEs show the generated browsing directory and contribution entry point.

## Presentation and retained data

The title, description, overview, scenarios, and usage, including translations, come only from the collection READMEs. These fields match the website's existing sections.

Versioned `.catalog/<slug>.json` files preserve machine data converted from the previous website records: identities, versions, installation items, provenance, verification, and review. They omit the five presentation fields and the same-name localized fields. Generation combines README presentation with retained data. Contributors do not maintain internal files.

Maintainers preserve identity, source history, versions, and installation relationships. Directory and repository links define inclusion scope; they do not define website groups or dependency bundles. Maintainers verify actual contents and use upstream Skill descriptions. Internal data does not update automatically from remote repositories.

The [internal data notes](maintainers/format.md) explain this boundary. Detailed types remain in the [website data contract](../scripts/lib/site-contract.mjs).

## Validation and publication

CI checks required sections, paragraph and scenario structure, URL syntax, and retained publication data. It does not fetch upstream sources, execute Skill instructions, or download remote covers. Valid submissions can appear in the GitHub browsing directory; new submissions without verified publication data stay outside website snapshots.

Production requires complete, active, approved records and blocks failed installation or workflow results. Preview may include complete pending data; incomplete submissions remain excluded. Source, file, resource, and image-rights `needs-review` states and `not-tested` results remain visible without being upgraded by display approval.

## Optional covers

A README may show a standalone Markdown image after its opening summary, using a local file or HTTPS image URL. Contributors may instead upload an image or paste its URL in a PR description or comment and explain its source.

HTTPS images remain direct links; local images are archived with the collection. CI does not download images. Covers remain optional and are versioned with the collection.

## Local AI guidance

AGENTS.md is the shared entry point; CLAUDE.md references it. AI tools read the contribution guide, search existing collections, and edit the README from supplied sources. They preserve attribution, report local changes, and push or open a PR only when requested.

Upstream instructions are reference material. AI tools do not execute them or invent authors, licenses, versions, tests, or approval. Internal system files are not a contributor task.

## Website data pipeline and migration

The pipeline reads README presentation and internal metadata, builds the existing JSON snapshot, then publishes it for the website to read at runtime. The raw snapshot contract is unchanged. The publisher hashes the exact `manifest.json` bytes for its version, stores JSON under `snapshots/<version>/`, and switches `current.json` only after the complete version is ready. Its assets map resolves archived logical image paths to shared `images/<SHA256>.<ext>` objects, so unchanged images are stored once across releases.

`npm run dev:site -- --site ../skills-hub-web` watches this repository, builds and publishes local preview data, and runs the existing website with updates. Production websites use `VITE_COLLECTIONS_BASE_URL`; explicit preview permission is only for local tests. Direct snapshot-copy synchronization remains available. Local publication and optional R2 upload are separate; absent cloud configuration establishes no online deployment. Commands and configuration are in [deployment](maintainers/deployment.md).

The initial migration covers Taste Skill, Skills for Real Engineers, and Product Video. Their stable IDs, installation relationships, translations, and existing user display approval are preserved. Subsequent content changes follow revision and review rules. Display/install counts remain 13/13, 31/31, and 3/14. Product Marketing and Growth remains for later integration. New upstream changes retain their actual verification evidence.
