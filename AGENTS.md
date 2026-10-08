# Repository rules

[Chinese reading guide](docs/rules.zh.md). `CLAUDE.md` references this file.

- Follow [CONTRIBUTING.md](CONTRIBUTING.md). Search existing collections before adding one; contributors edit readable collection READMEs. Link contribution and maintenance docs directly from the root README.
- Default to English; Chinese files use `.zh.md`. Keep each file in one language and update existing English/Chinese pairs together, including these rules.
- Collection display text comes from READMEs; Skill descriptions come from upstream. For internal data changes or publication, follow the [maintenance rules](docs/maintainers/format.md). Preserve identities, versions, and installation relationships; generate website data rather than editing output.
- Preserve attribution and actual verification states. Do not invent sources, licenses, approval, or test results. Display approval does not establish verification; passing checks does not establish publication eligibility.
- Run `npm run check` after changes and report the results accurately.
- Execute upstream Skill instructions, push, open pull requests, merge, or deploy only when the user requests it.
