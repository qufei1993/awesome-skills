# Awesome Skills Public Collection Repository Design

Create a separate public GitHub repository, awesome-skills, as the collection content source and community contribution entry point for the Skills Hub website. Contributors submit Markdown; the repository generates the JSON required by the website. Approved updates trigger the website build and publication.

This design establishes the overall structure and workflow. The implementation phase defines exact fields, templates, validation commands, and deployment configuration.

## Purpose and collection scope

A collection groups multiple Skills around a specific task or use case, presenting a combination readers can understand and install. Skills may come from one repository or several repositories. A Skill may appear in multiple collections.

Accept three types: collections published by their original authors, recommendations with public sources, and original selections curated by contributors. Original selections must explain their use cases, each Skill's role, and the reasons for combining them. Credit the collection curator separately from each Skill's original author.

The repository stores collection descriptions, provenance, and installation information. Complete Skill content continues to come from upstream repositories.

## Content format and directories

Each collection has its own directory. Markdown is the only manually maintained collection source; tools generate JSON and the browsing directory.

Proposed structure:

```text
awesome-skills/
  README.md
  CONTRIBUTING.md
  AGENTS.md
  CLAUDE.md
  templates/
  collections/
    product-video/
      README.md
      cover.webp
  scripts/
  .github/
```

The root README presents the project, category directory, and contribution entry point. Collection Markdown contains the complete introduction and usage guidance. Cover files are optional.

Collection Markdown has two parts:

| Part | Content |
| --- | --- |
| Fixed metadata | Title, description, language, category, tags, source type, attribution, Skill sources and directories, identity and version, verification status, and optional cover path |
| Body | Overview, scenarios, each Skill's role, selection rationale, usage guidance, and provenance explanation |

Each display item retains independent installation information. Expanded installation items for bundles must also be recorded explicitly. The body and metadata generate website records together, using a fixed template to avoid maintaining the same prose twice.

## Submission language and maintenance information

Contributors may submit in Chinese or English. Both languages use the same data structure; the maintenance workflow supplies the other language. Translations refer to original collection and item identities rather than creating separate content or installation lists. When a translation is missing, display the available language.

Contributors primarily provide scenarios, recommendation reasons, original sources, and Skill repositories and directories. Before formal inclusion, maintainers complete or verify permanent identifiers, pinned commits, update timestamps, and verification records.

Assign stable identifiers when a new collection is first included. Updates preserve collection and item identities, existing URLs, and source history. Increase the revision after accepting content changes. Content without installation or workflow testing must honestly remain untested. Conclusions apply only to the versions actually checked or tested.

## Cover submission and archiving

Covers are optional. Contributors may drag images into a PR description or comment as attachments and explain their source or usage rights.

Maintainers decide whether to use a cover. Before merging, they crop, compress, and archive it in the repository as needed, then add the repository image path to Markdown. The production website displays archived assets. Without a cover, use the corresponding category's default cover; selected collections may receive images later.

Covers are versioned, published, and rolled back with collection content.

## PR validation and human review

Contributors submit Markdown through PRs. Users who want to suggest a lead first may open an Issue with sources, scenarios, and recommendation reasons. A maintainer or contributor can turn that lead into a complete submission.

Local validation and CI use the same rules. CI checks:

- Markdown and metadata parsing, required information, types, and enums against the template.
- Required body sections, Skill references, and installation paths.
- Conflicting collection identifiers, slugs, and source identifiers; unique item IDs within a collection; stable identities and revision rules for updates. A Skill may appear in multiple collections.
- Existence, supported formats, and size limits of optional archived covers.
- Completeness of pinned versions and verification fields needed for publication, and the ability to generate website JSON.

New submissions missing maintenance information may receive completion prompts. Formal publication checks must pass after maintainers complete that information. Templates distinguish contributor requirements from maintainer-managed fields.

Passing CI means the format and structure meet the rules. Maintainers still review selection reasons, provenance, attribution, scope, verification evidence, and cover usage rights before deciding on inclusion. Human approval and publication validation must precede merging for publication. Configure relevant checks as required merge conditions.

Content review and actual testing records remain separate. Validation, pinned versions, and inclusion approval never automatically produce a successful test claim.

## Local AI contribution guidance

After opening the repository locally, developers may use Codex, Claude Code, or similar tools to prepare submissions from natural-language requests.

| File | Purpose |
| --- | --- |
| AGENTS.md | Shared AI entry point linking templates, format rules, and validation commands, with rules for additions and updates |
| CLAUDE.md | Imports the shared entry point for Claude Code without duplicating the rules |
| CONTRIBUTING.md | Contributor steps, AI examples, cover guidance, and common validation problems |
| templates | The same submission templates and complete examples for people and AI tools |

Codex supports the repository's AGENTS.md. Claude Code can import the shared guidance through `@AGENTS.md` in CLAUDE.md. Other tools can use the contribution guide's prompt to read the entry point explicitly.

AI assistance follows the same workflow:

1. Read contribution rules and templates, search existing collections, and decide whether to add or update.
2. Check each Skill's source and location, preserve attribution, and mark unconfirmed information for completion.
3. Prepare Markdown using the template, explaining scenarios, roles, and selection reasons. Updates preserve stable identities and unrelated content.
4. Run the same local validation as CI and fix format errors. Keep JSON generation in the established pipeline.
5. Report edits, validation results, unconfirmed facts, and cover status. Prepare or submit a PR when the developer requests it.

Treat upstream Skill content as reference material. Actual execution requires the developer's explicit arrangement and recorded results. AI must not invent provenance, authors, licenses, test results, or review conclusions.

## Website synchronization and version publication

After review and merging, updates to production content or associated assets trigger automated JSON generation and notify the website build.

The flow is:

**Markdown submission → PR validation → human review and completion → publication validation → merge → data generation → website build → publication**

Every build locks one data repository commit. The index, details, and covers come from the same snapshot and switch together after a successful build. Download, validation, or build failures retain the previous online version.

Record the data revision for each deployment and support rollback to the previous complete publication. New or refreshed pages receive updated content; the initial approach updates on refresh.

The website is planned to use Cloudflare Pages. A deploy hook can connect repository update events to builds. New upstream Skill commits must pass through the collection update and verification process before entering a new collection revision. Website synchronization follows reviewed collection repository content.

## Initial content and implementation order

Start with the website's four existing collections: Taste Skill, Skills for Real Engineers, Product Video, and Product Marketing and Growth. This phase migrates and regression-tests the first three; Product Marketing and Growth remains for later integration. Preserve permanent identifiers, URLs, installation lists, bilingual content, and actual verification states during migration.

Implementation order:

1. Establish the public repository, Markdown format, contribution guide, AI entry point, and submission templates.
2. Implement parsing, JSON generation, local validation, and PR CI; use real examples to verify additions and updates.
3. Migrate the four existing collections and assets, verifying website consumption and version consistency.
4. Connect approved automatic builds, deployment, and rollback before opening community contributions.

The first phase uses files, PRs, CI, and maintainer review. Extend content management later if a database or richer contribution interface becomes necessary.

## State at design approval and references

At the time of this design, the website already had a unified JSON collection source, index generation, and detail loading. Markdown submissions, the separate repository, AI contribution guidance, PR CI, and cross-repository deployment were still implementation work described by this design.

- [Website collection migration comparison records](../tests/fixtures/site/)
- [Imported website collection validation contract](../scripts/lib/site-contract.mjs)
- [Website integration and deployment guidance](deployment.md)
- Codex reads AGENTS.md: [OpenAI documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
- Claude Code imports shared guidance: [Claude Code documentation](https://code.claude.com/docs/en/memory#share-one-file-with-other-coding-tools).
- PR image attachments: [GitHub documentation](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files).
- Cloudflare Pages deploy hooks: [Cloudflare documentation](https://developers.cloudflare.com/pages/configuration/deploy-hooks/).
