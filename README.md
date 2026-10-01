# Awesome Skills

Task-focused Skill collections for Skills Hub. Installable Skills stay in their upstream repositories; this repository records why they belong together, where they come from, and which versions were checked.

[中文贡献指南](CONTRIBUTING.md) · [Contribution quick start](CONTRIBUTING.md#english-quick-start) · [Format](docs/format.md) · [Deployment](docs/deployment.md)

## Browse collections

This directory is generated from collection Markdown. Pending collections are available for review; inclusion here does not imply approval or successful installation.

<!-- catalog:start -->
- [Skills for Real Engineers](collections/engineering/README.md) — 从需求澄清到实现与验证，把工程经验带进 Agent 协作。 (pending review)
- [产品宣传视频](collections/product-video/README.md) — 先明确需求，再制作画面，用 Skills 配合完成产品宣传视频。 (pending review)
- [Taste Skill · 前端设计](collections/taste/README.md) — 从排版、风格到动效，让 AI 生成的界面更有设计感。 (pending review)
<!-- catalog:end -->

## Contribute

Submit in Chinese **or** English. Author collections, sourced recommendations, and original selections across repositories are welcome. Explain the task, each Skill's role, and why the combination helps.

Use Node.js 22 and start with:

```sh
npm ci
npm run new:collection -- my-collection --lang en
```

Fill the generated Markdown using the [template instructions](templates/README.md), then run `npm run check`. Each Skill has its own entry point and installation list. Covers are optional. JSON and the catalog directory are generated; edit Markdown instead.

## Publication status

The initial Taste, Engineering, and Product Video collections retain their existing identities and installation records. Their content reviews are pending. Installation and workflow checks remain `not-tested`; the 13/31/14 installation counts describe expanded lists, not successful tests.

Production snapshots include eligible active, approved collections only. Preview snapshots include pending records and cannot be synced to the website. GitHub branch protection and website deployment require maintainer configuration; this repository does not establish that either is enabled.
