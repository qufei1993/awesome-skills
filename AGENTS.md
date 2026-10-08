# Repository rules

[Chinese reading guide](docs/rules.zh.md). `CLAUDE.md` references this file.

- Follow [CONTRIBUTING.md](CONTRIBUTING.md). Search existing collections before adding one; contributors edit readable collection READMEs. Link contribution and maintenance docs directly from the root README.
- Default to English; Chinese files use `.zh.md`. Keep each file in one language and update existing English/Chinese pairs together, including these rules.
- Contributors submit READMEs and optional covers; do not add `.catalog` JSON. CI resolves linked upstream Skills and generates website data under `dist/`. Follow the [maintenance rules](docs/maintainers/format.md) for identities, versions, and installation relationships; keep the three migrated legacy records compatible.
- Collection display text comes from READMEs; Skill descriptions come unchanged from upstream. Format validation is offline; building previews resolves upstream data and needs network access.
- Preserve attribution and actual verification states. Do not invent licenses, approval, or test results. Production approval comes from an actual reviewed PR merge into `main`, verified by trusted publication CI; passing checks alone does not approve data.
- Run `npm run check` after changes and report the results accurately.
- Execute upstream Skill instructions, push, open pull requests, merge, or deploy only when the user requests it.
