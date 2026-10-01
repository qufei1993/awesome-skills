# Migration Verification for Three Existing Collections

This phase covers Taste Skill, Skills for Real Engineers, and Product Video. Product Marketing and Growth is outside this migration phase. Original website JSON is retained as immutable comparison data in `tests/fixtures/site/`; manually maintained content is now `README.md` in each collection directory. Initial migrated Markdown and covers are pinned in `tests/fixtures/migrated/collections/`. Exact migration regression checks use only these historical fixtures. The live `collections/` directory permits new submissions, normal revisions, and later approvals without restrictions from historical three-collection counts or review-status assertions.

## Preserved data and approval boundaries

Migration preserves collection UUIDs, slugs, revisions, creation/update times, historical source keys, provenance evidence, item IDs, pinned commits, installation directories, license records, body content, and English translations. `tests/migration.test.mjs` compares complete documents parsed from fixed historical fixtures against original JSON field by field. It adds actual curator attribution through `curator` and permits these review differences:

- `review.status` changes from `approved` to `pending`.
- Original `review.notes` are preserved, with a note that integration into the new repository awaits source, resource, and cover review.
- `reviewer` and `reviewedAt` from the prior display-migration approval are removed.

Previous approval covered only the website's display migration. It cannot automatically approve integration into the new repository, sources, resources, or cover rights. Migration does not increase revisions or turn pinned commits, format validation, or public examples into successful test claims.

These three collection documents use Chinese canonical content and preserve `localizations.en`. `language: zh` and `cover.file` are Markdown management fields and do not enter website JSON documents. `curator: {name: Skills Hub, url: https://github.com/qufei1993/awesome-skills}` is actual curator attribution, exported to JSON and used for index presentation. It remains separate from original Skill authors and public recommenders. Original JSON without attribution does not automatically receive a curator.

## Installation statistics and covers

| Collection | Display items | Deduplicated installations | Cover |
| --- | ---: | ---: | --- |
| Taste Skill | 13 | 13 | `collections/taste/cover.webp` |
| Skills for Real Engineers | 31 | 31 | `collections/engineering/cover.png` |
| Product Video | 3 | 14 | Original `video` concept cover |

Installation items deduplicate by `(repo, commit, directory)`. Product Video's 14 items count expanded bundle installations, not actual tests. The two source images were copied from the website's existing archived assets. Markdown parsing preserves the original `cover.url`; preview generation changes it to the archived path within the snapshot. Regression checks compare exported image bytes with migration source images and ensure index and detail records come from the same batch.

## Outstanding verification

| Collection | Source | Files and resources | Installation | Workflow | Source-cover rights |
| --- | --- | --- | --- | --- | --- |
| Taste Skill | `verified` (retained from the original record) | `needs-review` | `not-tested` | `not-tested` | `needs-review` |
| Skills for Real Engineers | `needs-review` | `needs-review` | `not-tested` | `not-tested` | `needs-review` |
| Product Video | `verified` (retained from the original record) | `needs-review` | `not-tested` | `not-tested` | Concept cover; no claim that it is a finished example video |

Original verification notes, evidence scope, and license records are preserved. This task did not download every upstream entry again, inspect all resource references, external-directory dependencies, or installation environments, install or run any third-party Skill, or produce an example video. Maintainers must perform actual verification, confirm source-cover usage rights, and review again before approving production inclusion.

## Reproducible checks

```sh
node --test tests/markdown.test.mjs tests/migration.test.mjs
npm test
npm run validate
npm run build:preview
npm run build
```

Parser tests first failed without the implementation, then verified lossless round trips for all three original JSON files. Additional boundary tests cover strict YAML parsing, body structure, images, code fences, and translation fields. Migration regression first failed before `collections/` existed, then exercised real Markdown and generated snapshot integration.

Integration regression uses temporary copies of fixed historical fixtures. It verifies that this migration snapshot's preview contains 3 collections, display counts are 13/31/3, and deduplicated installation counts are 13/31/14. The original website contract revalidates each exported detail and index. This historical snapshot's production build must export 0 collections because all three historical records are pending. This is a migration-time result, not a restriction on later approved records in the live directory. Additional regression legitimately adds a fourth draft and updates Taste prose and revision in a temporary live directory, then reruns historical migration checks to ensure fixed assertions do not block normal contributions.

On 2026-10-01, `node --test tests/migration.test.mjs` passed 2/2 tests, followed by `npm test` passing 53/53. Real migration regression exposed a new validation rule incorrectly rejecting the Engineering collection's existing `cover.background: "#fff"`. Validation was corrected to accept valid three- or six-digit hexadecimal colors; the original data was not rewritten.

Later that day, migration assertions were moved to fixed historical fixtures, and curator attribution was normalized and preserved in JSON. Two regressions first failed because attribution was dropped and a fourth draft triggered the fixed-directory assertion. After correction, parser and migration tests passed 29/29, and the project suite passed 65/65. Temporary community submissions and prose updates in migration tests passed real submission validation without affecting historical snapshot regression results.

Successful checks establish only that migration and generation meet the contract. Cloudflare deployment, pushing the public repository, and online website updates require separate configuration and execution; this record does not claim those actions occurred.

## Final overall checks

On 2026-10-01, after final independent review, all 65 tests in `npm run check` passed, submission validation passed, and the live directory's preview exported 3 collections. `npm run validate:publish` passed, and production generation excluded these 3 pending collections. When introducing content for the first time, an old baseline without `collections/` may be validated as empty; a missing directory in the current content source still fails.

Sync regression covers installation of the real three-collection preview into a temporary website through the CLI, index/detail agreement, byte-identical assets, fixed revisions, checksums, path and ZIP boundaries, preview isolation, concurrency locks, and previous-version rollback. Corrupt updates preserve the installed snapshot. Permission failures while cleaning an older backup do not misreport an already completed switch as failed: `cleanupPending` is returned, and the previous version remains available for rollback. That permission regression creates an unreadable directory, reproduces EACCES, then verifies the fix.

Remote Release retrieval uses controlled HTTP responses to verify protocol and validation behavior. No GitHub Release was actually created; repository rules were not configured; the website was not notified; Cloudflare was not deployed. The website's current Vite local-data export must change during production integration. Full website-build acceptance and verification of the online data revision remain outstanding. See [deployment guidance](deployment.md).

## Bilingual documentation update

Project guides and templates now use English in their default files and Chinese in matching `.zh.md` files. Both README directories generate descriptions in their own language. Missing or partial translations use a slug and a localized translation status instead of inserting text from another language. New drafts default to English; `--lang zh` selects Chinese.

The update preserves the three collections' website JSON. Regression checks cover both languages, missing and partial translations, the draft default, and restoration of both README files and the old snapshot if the second README replacement fails. Repository rules remain in one concise `AGENTS.md`; `CLAUDE.md` references it.
