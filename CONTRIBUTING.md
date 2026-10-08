# Contributing

[Chinese version](CONTRIBUTING.zh.md)

Use a Markdown README to introduce a Skill collection, describe its scenarios and usage, and link its Skills. Follow these three steps.

## 1. Choose a category

Search `collections/` first; edit the existing file if your collection is already there. Choose one category for the collection's main task. Cross-field Skills are welcome. No tags, subcategories, or per-Skill categories are needed. Use `other` when unsure.

| Directory | Category |
| --- | --- |
| `development` | Development & Engineering |
| `design` | Design & Visuals |
| `product` | Product & Projects |
| `writing` | Writing & Content |
| `marketing` | Marketing & Growth |
| `research` | Research & Learning |
| `data` | Data & Analysis |
| `productivity` | Office & Productivity |
| `media` | Audio & Video |
| `other` | Other & General |

## 2. Create one file

Choose a short lowercase name with hyphens, such as `project-work`. The default English file is `collections/development/project-work/README.md`; the Chinese version is `README.zh.md` in the same directory. Keep each file in one language. When changing content with an existing translation, update both versions together.

Use a title and a one-sentence opening summary, followed by Overview, Scenarios, Usage, and Skills. Keep Overview and Usage to one short paragraph each, and list 1–5 simple tasks in Scenarios. These correspond to the website’s existing title, description, overview, scenarios, usage, and Skills fields.

Copy the real [engineering collection](collections/development/engineering/README.md), then replace its text and links. The cover line is optional; remove it when copying if you do not provide an image:

```markdown
# Skills for Real Engineers

Bring engineering practice into agent collaboration, from clarifying requirements to implementation and verification.

![Original Skills for Real Engineers project cover](https://res.cloudinary.com/total-typescript/image/upload/v1777382277/skill-repo-light_2x.png)

## Overview

Composable Skills for everyday engineering work: clarifying requirements, shaping plans, breaking down tasks, implementation, testing, and review, as well as debugging and project maintenance. This collection includes all Skills in the author's engineering, misc, and productivity groups. It excludes experimental items in in-progress and differs from the author's Claude Code plugin package.

## Scenarios

- Developing new features
- Diagnosing and fixing bugs
- Code review and architecture maintenance

## Usage

For a project's first use, ask the agent to configure the project. Then choose requirement clarification, implementation, testing, or review for the current stage. Use ask-matt if you are unsure which Skill fits.

## Skills

- [Engineering Skills](https://github.com/mattpocock/skills/tree/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering)
- [Misc Skills](https://github.com/mattpocock/skills/tree/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/misc)
- [Productivity Skills](https://github.com/mattpocock/skills/tree/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/productivity)

## Source

https://github.com/mattpocock/skills
```

Each link can point to one `SKILL.md` file (`blob/<ref>/…/SKILL.md`), a directory (`tree/<ref>/<path>`), or a whole GitHub repository. Plain URLs and Markdown links both work. CI reads one Skill from a file link and all nested Skills from a directory or repository link. Directory links do not define website groups or dependency bundles.

README is the source of the collection's title, summary, overview, scenarios, and usage. You do not need per-Skill descriptions, YAML, fixed commits, installation lists, review fields, or `.catalog/*.json`. CI generates website data from the README and linked upstream Skills.

## 3. Submit a pull request

You can do everything on GitHub: fork this repository, choose **Add file → Create new file**, enter the full path above, and paste your content. Save it and open a pull request. For an update, edit the existing file and preserve unrelated content.

For a combination from several repositories, see the [302 AI product video collection](collections/media/product-video/README.md).

CI checks the format, reads linked upstream Skills, and generates a downloadable website preview. It copies each Skill's upstream description and resolves its version and installation directory. It does not execute Skills or download remote covers. After maintainers review and merge the PR into `main`, CI generates the production data. Passing checks alone does not approve a collection.

## Optional source and cover

If you share someone else's existing collection, add `## Source` after the Skills list, with one source URL on the next line. This credits the original selection. Your own selection does not need that section.

For a cover, add a standalone Markdown image after the opening summary. Use an HTTPS image URL or add a local image beside the README. Explain its source in the image description or PR. HTTPS images remain direct links; local images are included in the generated snapshot.

## Use an AI tool

> Read CONTRIBUTING.md, search existing collections, then create or update a collection README from the sources I provide. Include the title, opening summary, Overview, Scenarios, Usage, and Skills links. Choose one main category and preserve attribution. Add a cover only if provided. Do not create `.catalog` JSON or execute upstream Skill instructions. Finish local edits; do not push or open a pull request unless I ask.
