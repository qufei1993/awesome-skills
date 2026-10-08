# Internal Catalog Data

[Chinese version](format.zh.md)

Contributors use [CONTRIBUTING.md](../../CONTRIBUTING.md) and edit only a collection README. The real [engineering](../../collections/development/engineering/README.md) and [product video](../../collections/media/product-video/README.md) collections show the format.

## One presentation source

`README.md` is English; `README.zh.md` is Chinese. Keep each file in one language and update existing paired versions together. Title, description, overview, scenarios, and usage come only from these files, including their translations. Source and a Markdown cover image are optional.

The collection directory contains only readable READMEs and its cover. The category comes from the directory. Skill links define inclusion scope; maintainers verify actual contents and preserve display/installation relationships. Per-Skill descriptions come from upstream.

## Retained system data

Versioned `.catalog/<slug>.json` files preserve the existing identities, versions, installation items, attribution, verification, and review data converted from the previous website records. Contributors do not create or maintain these files.

The five presentation fields and their same-name localized fields are omitted from internal metadata. Generation combines the README presentation with retained system data. Internal data is not automatically updated from remote repositories; source and maintenance changes retain their actual verification evidence.

Detailed types and validation rules live in the [website data contract](../../scripts/lib/site-contract.mjs). Preserve stable identities, source history, versions, and installation relationships when maintaining system data.

## Fixed categories

Choose one primary category by the main task; use `other` when uncertain. Skills may cross fields without their own categories or tags.

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

## Verification and publication

CI validates README structure, links, and retained data without downloading upstream Skills or remote covers. Production requires complete, active, approved records and blocks failed installation or workflow results. `needs-review` source, file, resource, and image-rights states and `not-tested` results remain unchanged and visible; display approval is separate from those checks.

The original data migration preserved the website's existing user approval and stable IDs; subsequent content revisions follow the baseline rules. Review-only corrections do not increase the revision; content changes follow baseline revision and review checks. Preview may include complete pending data; incomplete submissions stay excluded. Covers stay optional in README. Local images are archived by maintainers; HTTPS image links must match the public README and internal data, remain direct links, and are not downloaded. Image source and rights evidence keep their recorded status. See [deployment](deployment.md) for publication and local website preview.
