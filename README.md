# Awesome Skills

Task-focused Skill collections for Skills Hub. Skills stay in their upstream repositories. This catalog records their purpose, sources, installation lists, and verification status.

[Chinese version](README.zh.md) · [Contributing](CONTRIBUTING.md) · [Format](docs/format.md) · [Deployment](docs/deployment.md)

## Browse collections

This directory is generated from collection Markdown in the language of this page. Pending collections are available for review. A listing does not imply approval or successful installation. Collections without an English presentation use their slug until a translation is available.

<!-- catalog:start -->
- [Skills for Real Engineers](collections/engineering/README.md) — Bring engineering practice into agent collaboration, from clarifying requirements to implementation and verification. (pending review)
- [Product Promo Videos](collections/product-video/README.md) — Clarify the brief, build the visuals, and combine Skills to create a product promo video. (pending review)
- [Taste Skill · Frontend Design](collections/taste/README.md) — Give AI-generated interfaces a stronger design direction, from typography and visual style to motion. (pending review)
<!-- catalog:end -->

## Contribute

Submit in English or Chinese. Author collections, sourced recommendations, and original selections across repositories are welcome. Explain the task, each Skill's role, and why they work together.

Use Node.js 22 and create a draft:

```sh
npm ci
npm run new:collection -- my-collection
```

Drafts use English by default. Use `--lang zh` for a Chinese submission. Follow the [template instructions](templates/README.md), replace the source placeholders, and run `npm run check`.

Each Skill has its own entry point and installation list. Covers are optional. Edit Markdown; JSON and the catalog directory are generated.

## Documentation

Project documentation and templates use English in the default file. Chinese versions use the `.zh.md` suffix. Update both versions together and keep each document in one language.

AI tools share one [AGENTS.md](AGENTS.md). [CLAUDE.md](CLAUDE.md) references that file.

## Publication status

The initial Taste, Engineering, and Product Video collections retain their identities and installation records. Their reviews are pending. Installation and workflow checks remain `not-tested`. The 13/31/14 installation counts describe expanded lists, not successful tests.

Production snapshots contain eligible active, approved collections. Preview snapshots include complete pending records and require explicit local preview mode for synchronization. Website integration and GitHub review requirements still need maintainer configuration. See the [verification report](docs/verification.md).
