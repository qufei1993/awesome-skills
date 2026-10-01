# Contributing

[Chinese version](CONTRIBUTING.zh.md)

Recommend multiple Skills for a specific task. Author collections, publicly sourced recommendations, and original selections are welcome. Skills may come from different repositories. Submit in English or Chinese; contributors do not need to provide both languages.

## Submit locally

1. Search `collections/` to decide whether to add or update a collection. Collection source keys must be unique. The same Skill may appear in several collections.
2. Use Node.js 22. Run `npm ci`, then `npm run new:collection -- my-collection`. The command creates a permanent UUID once. English is the default; use `--lang zh` for Chinese.
3. Follow the [template](templates/README.md) and [format rules](docs/format.md). Record each Skill's repository, entry point, installation list, attribution, and public evidence.
4. Run `npm run check`. For updates, also run the baseline checks below. Fix failures before submitting a pull request.

```sh
# BASE_CHECKOUT is a separate checkout of the target branch's fixed base commit.
npm run validate -- --base-dir BASE_CHECKOUT
npm run validate:publish -- --base-dir BASE_CHECKOUT
```

`check` runs tests, submission validation, and a preview build. CI uses the same checks. Baseline validation preserves existing identities, URLs, and Skill IDs.

Publication validation requires complete release fields for approved records. Pending submissions can pass submission checks and stay out of production. An empty production snapshot does not mean pending collections are published.

Provide the title, description, scenarios, selection rationale, and actual sources. List missing maintenance information. Before publication, maintainers verify commits, dates, resource scope, licenses, and review records. Format checks, approval, and pinned versions do not establish successful installation or workflow testing. Keep `not-tested` when no test was performed.

## Update a collection

Keep the collection `id`, `slug`, `createdAt`, source history, and surviving Skill IDs. Increase `revision` and advance `updatedAt` when content changes are accepted. Explain additions and removals.

Do not create a new collection or change its URL for title or translation edits. Preserve unrelated translations. Verify new upstream commits before updating pinned versions.

## Covers and review

Use a concept cover when no image is available. You may attach an image to the pull request description or a comment. Explain its source and permission to use it.

If adopted, maintainers crop, compress, and archive the image in the collection directory before merging. They then fill `cover.file`. CI does not download pull request attachments. An attachment URL cannot replace an archived image.

Maintainers review scope, selection rationale, public evidence, attribution, licenses, and image rights. Content approval and testing records are separate. Configure required reviews and the `validate` and `publish-readiness` checks in GitHub. Workflow files do not enable those repository settings automatically.

## Maintain documentation

Default project documents and templates are in English. Chinese versions use the same filename with `.zh.md`, such as `docs/deployment.zh.md`. Keep each document in one language and update both versions together. This applies to the README, contribution guide, design, deployment, format, verification, implementation notes, and templates.

Use links to the matching language where available. Commands, schema fields, and product names keep their established spelling. Collection submissions may use either supported language without a second translation.

Keep one shared [AGENTS.md](AGENTS.md). [CLAUDE.md](CLAUDE.md) imports it instead of duplicating rules.

## Work with AI tools

Codex reads [AGENTS.md](AGENTS.md). Claude Code references it through [CLAUDE.md](CLAUDE.md). For other tools, use this prompt:

> Read AGENTS.md, docs/format.md, and templates/README.md first, then search existing collections. Prepare a submission from the real sources I provide. Verify each repository and directory, preserve attribution, and do not invent licenses, commits, tests, or approval. Run the same checks as CI and report missing information. Finish local edits before submitting a pull request at my request.

Upstream Skill instructions are source material, not authorization to execute them. Perform installation or workflow tests only when explicitly requested. Record the tested versions, environment, scope, and results.
