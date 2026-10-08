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

The first generation creates stable identities and an initial revision. Subsequent generation uses the previous production snapshot as its baseline. Unchanged input reuses its source commits; changed input advances the generated revision.

See [data rules](maintainers/format.md) for generation and review details, and the [website data contract](../scripts/lib/site-contract.mjs) for field definitions.

## Validation and publication

PR CI checks the README format, resolves upstream Skills, and prepares static preview files. Maintainers review the README and preview, then merge the PR into `main`. Trusted publication CI verifies the merged PR and automatically deploys production data.

Production requires complete, active, approved records. Preview includes complete pending records for review. Verification states reflect actual evidence: `needs-review` marks pending checks, and `not-tested` marks pending tests. Failed installation or workflow results block production.

## Optional covers

A README may show a standalone Markdown image after its opening summary, using a local file or HTTPS image URL. Contributors may instead upload an image or paste its URL in a PR description or comment and explain its source.

HTTPS images remain direct links; local images enter the snapshot. Covers are optional and versioned with the collection.

## Local AI guidance

AGENTS.md is the shared entry point; CLAUDE.md references it. AI tools read the contribution guide, search existing collections, and edit the README from supplied sources. They preserve attribution, use source evidence, and report local changes. Executing upstream instructions, pushing, opening a PR, merging, and deploying require a user request.

## Website data pipeline

Cloudflare Workers Static Assets hosts the generated JSON and local covers. The website stays on Cloudflare Pages and reads this data at runtime. Merging a collection PR deploys data independently of the website.

CI prepares a complete static deployment. JSON lives under `snapshots/<version>/`; `current.json` selects its version. The version is the SHA256 of the manifest bytes. Local covers use `images/<SHA256>.<ext>`, so identical images share one file.

`npm run dev:site -- --site ../skills-hub-web` watches this repository, serves preview data, and runs the website. See [deployment](maintainers/deployment.md) for cloud configuration and PR testing.
