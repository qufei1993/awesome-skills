# Markdown Collection Format

Manually maintain only `collections/<slug>/README.md` and archived covers. The generator maintains JSON, indexes, and the root README region between `<!-- catalog:start -->` and `<!-- catalog:end -->`.

## File structure

YAML frontmatter at the beginning stores machine-readable fields. Organize the body in the following order. See the [Chinese format guide](format.zh.md) for the supported Chinese section headings.

| Level | Heading | Content |
| --- | --- | --- |
| H1 | Collection title | One title, followed by a description paragraph |
| H2 | Overview | Purpose and selection rationale |
| H2 | Scenarios | A list of 1–5 scenarios |
| H2 | Usage | Order, prerequisites, and considerations |
| H2 | Skills | One H3 for each Skill |
| H3 | Skill name | A summary paragraph and one `yaml` fence |

The title, description, overview, scenarios, usage, Skill names, and summaries come from the body. Do not duplicate them in machine fields. A `#` inside a code fence is not a body heading. YAML rejects duplicate keys, aliases, merge keys, and unknown fields to avoid ambiguity.

## Frontmatter

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Currently `1` |
| `language` | `zh` or `en`; contributors may choose either |
| `id` | UUID v4 assigned on creation and retained permanently |
| `slug` | Lowercase URL name using letters, digits, and single hyphens; matches the directory |
| `revision` | Positive integer starting at 1, increased when content changes are accepted |
| `createdAt`, `updatedAt` | UTC timestamps; update time must not precede creation time |
| `sourceKeys` | Stable deduplication identifiers for public collection sources; retain source history |
| `status` | `active` or `archived` |
| `sourceKind` | `author-repository`, `external-recommendation`, or `editorial-selection` |
| `category` | `development`, `product`, `research`, `productivity`, `marketing`, `design`, `video`, or `other` |
| `tags` | At most 8 tags |
| `provenance` | Attribution, selection reasons, public evidence, and optional author repository scope |
| `cover` | Default concept cover, or an archived image in this directory with rights evidence |
| `verification` | Source, file, installation, and workflow verification states and records |
| `review` | Content review, separate from actual testing |
| `sortOrder` | Optional numeric ordering |
| `curator` | Optional collection curator attribution, separate from Skill authors |
| `localizations` | English display fields retained during migration; item translations refer to original Skill IDs |

Never fill draft templates with invented commits, licenses, or reviewers. Pending drafts may omit maintainer fields such as `schemaVersion`, `id`, `revision`, timestamps, `sourceKeys`, review or verification records, evidence check dates, and pinned commits. The new-collection command still generates a real permanent UUID. Contributor prose, public sources, Skill IDs, paths, installation items, and license records remain required.

The generator applies conservative defaults only to a validation copy. It does not write fabricated identities or verification claims back to Markdown. Drafts missing fields required by the website contract are reported and excluded from preview data. Empty template strings are editing prompts, not valid submissions. The [template guide](../templates/README.md) links three real collections; never copy their facts into an unrelated submission.

`provenance.author` and `provenance.recommender` use `name` and `url`. Public recommendations must identify the recommender. Original selections must provide `selectionReason`. Author repository collections use `repositoryScope` with `repo`, pinned `commit`, `directories`, and `coverage: all-valid-skills`. Entries must stay within that declared scope.

`provenance.evidence` is a list. Each item contains `id`, `kind` (`repository`/`article`/`post`), `url`, `title`, `publisher`, `location`, `finding`, `checkedAt`, and `supportsItemIds`, with optional `publishedAt`. Evidence must support every display item. Distinguish the publicly documented recommendation relationship from the versions actually checked.

## YAML for each Skill

Place one independent YAML fence beneath each H3. It contains `id`, `entry`, `installationMode`, `installationItems`, `resourceCheck`, and `resourceNotes`; optional fields are `role`, `authors`, and `originalDescription`. Do not move all Skills into frontmatter or share one installation list among display items.

- `entry`: use GitHub `owner/repo` for `repo`, a full 40-character SHA for `commit`, and a repository `SKILL.md` path for `entryPoint`.
- `installationMode: skill`: exactly one installation item. `bundle`: at least two. The entry must correspond to one actual installation item.
- Each installation item contains `name`, `repo`, `commit`, `directory`, `entryPoint: SKILL.md`, and `license`. `directory` is repository-relative; use `.` for the repository root. Absolute paths, `..`, and backslashes are prohibited.
- `license`: `identifier` and optional `evidenceUrl`. Record unknown licenses honestly, for example as `NOASSERTION`; this does not establish permission to use the content.
- `resourceCheck`: `verified` or `needs-review`. `resourceNotes` explains resource references, dependencies, and unresolved checks.
- Optional `authors`: each person uses `name` and `evidenceUrl`. The curator is not the original author of every Skill.

Display item counts and installation counts may differ. Installation statistics deduplicate by `(repo, commit, directory)`. Product Video has 3 display items expanding to 14 installation items; 14 is not a successful test count.

## Review, verification, and covers

`review.status` is `pending`, `approved`, or `rejected`. Approval or rejection requires a real `reviewer` and `reviewedAt`; `notes` preserves the scope and reasons.

`verification.source/files` uses `verified` or `needs-review`; `installation/workflow` uses `not-tested`, `passed`, or `failed`. `checkedAt` and `notes` record verification scope. Actual `passed/failed` states require corresponding evidence containing `testedAt`, `versions`, `itemIds`, `resultRef`, and `environment`. Pinned commits and CI success cannot replace this evidence.

The default is a concept cover. Supported presets are `design`, `engineering`, `marketing`, `video`, and `neutral`. A `source-image` records `file` (relative to the collection directory), `sourceUrl`, `alt`, `rightsStatus`, and verified `rightsEvidenceUrl`. Optional dimensions, background, and position affect presentation only.

Archived images must be nonempty PNG, JPEG, WebP, or GIF files, no larger than 5 MiB. File contents must match the declared format. Path and symlink escapes are prohibited. Maintainers archive image attachments; CI does not download remote images.

## Submission validation and production export

```sh
npm run check
npm run validate -- --base-dir BASE_CHECKOUT
npm run validate:publish -- --base-dir BASE_CHECKOUT
npm run build:preview -- --output dist/collections
npm run build -- --output dist/collections --source-revision FULL_COMMIT_SHA
```

Submission checks validate structure, paths, identity conflicts, and update stability. Publication checks require approved records to have pinned versions, verified source/files/resources, no failed tests, and usable covers with confirmed rights. Installation and workflow states may honestly remain `not-tested`; do not present them as successful tests. Pending records do not enter production data.

Preview includes pending records and marks the manifest `preview: true`; it cannot synchronize to the production website. The three initial migration examples are pending, so their production snapshot is empty. This does not mean the three collections are online. Maintainers must complete actual review and missing verification before approval. Translations retain collection and item identities; a missing second language falls back to the available language.

## Project documentation language

Project documentation and templates use English in the default `.md` file and Chinese in a separate file with the same name plus `.zh.md`. Keep paragraphs and heading tables in one language per document. Update both versions in the same change and use links to the matching language version, except explicit links to an alternate-language guide. `AGENTS.md` remains one concise English rules file; `CLAUDE.md` imports it.
