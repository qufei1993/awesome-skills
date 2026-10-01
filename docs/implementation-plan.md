# Awesome Skills Implementation Plan

**Goal:** Implement the approved Markdown catalog, PR validation, AI guidance, snapshot export and site sync; exercise Taste, Engineering and Product Video.
**Spec:** docs/design.md
**Architecture:** Node.js 22 ESM; YAML frontmatter and Markdown AST; no upstream Skill execution. Markdown is the sole editable content. Generated JSON targets the existing Skills Hub contract.
**Execution:** Root integrates independent parser, compiler and documentation tasks with tests and independent review.

## Decisions and interfaces

- Stage: /tmp/awesome-skills-implementation; original repo b58a533540f6607a3c2755457ee1639b9c4c1ad3; target branch codex/markdown-collections.
- Three source fixtures are immutable expectations under tests/fixtures/site. Live Markdown collections preserve identity, source and installation data. Their review becomes pending because prior approval covered display migration, not fresh source verification. Keep original review notes and all verification states; do not claim tested.
- Root catalog has a generated directory between HTML markers. Pending records may be browsed on GitHub and in preview. Production exports only active+approved records whose source/files/resources are verified, no failed tests, and usable cover. Do not create fake approval.
- YAML parses without duplicate keys, aliases or merge keys. Unknown fields rejected at owned boundaries. Markdown AST selects actual heading and code nodes, not heading-looking text in fences.
- Canonical collections/<slug>/README.md: frontmatter contains machine metadata, H1 title, opening description, H2 Overview/Scenarios/Usage/Skills (Chinese equivalents allowed). Under Skills each H3 is name, prose is summary, one yaml fence holds id, entry, installationMode/items, resourceCheck/Notes and optional role/authors/originalDescription.
- Existing localizations.en remain in frontmatter for lossless migration. Support independent optional README.en.md / README.zh.md presentation overlays if feasible; canonical English accepted, no fabricated translation.
- Covers: cover.file relative to same collection dir; compiler emits hosted URL; body can reference relative image. Never fetch attachment URLs in CI.
- Imported site-contract.mjs is the existing pure validation/index contract. Export validateCollection and indexItem for reuse, retaining contract behavior; compiler adds stricter release checks and safe cover handling.

## Tasks

1. Parser: scripts/lib/markdown.mjs exports parseCollectionMarkdown(source,{filename}), serializeCollectionMarkdown(document,{language,coverFile,curator}), parseTranslationMarkdown where implemented. Parser returns {document,language,coverFile,curator}. Throws filename/field errors. Parser preserves missing maintenance fields without generating defaults, identities, timestamps, commits or verification claims; compiler uses a separate submission-validation copy for incomplete drafts, which cannot publish. Tests prove round-trip all three fixtures and malformed structures.
2. Compiler: scripts/lib/catalog.mjs exports loadCatalog({rootDir,mode='submission',baseDir}), validateCatalog(options), buildCatalog({rootDir,outputDir,preview=false,baseDir,sourceRevision}); return index and records. scripts/catalog.mjs CLI handles validate [--publish --base-dir], build [--preview --output], new. Input parser result to existing website JSON. Check duplicate identities/source keys, paths, covers, stable updates and revisions. Stage entire output snapshot before replacing, manifest checksums. Generate README marker directory. Test collisions, release gate, dedup counts and failed-build preservation.
3. Docs/CI: README/CONTRIBUTING/AGENTS/CLAUDE, docs/format.md and docs/deployment.md, templates, PR and Issue templates, workflows. Root entry AGENTS single source; CLAUDE imports. PR schema checks use read-only token and no secrets; validate updates against base. Publishing only push main after approved changes, immutable generated snapshot artifact and optional authenticated website notification. CI doesn't auto-run submitted Skills.
4. Root integration: import three real fixtures to readable MD, copy their referenced covers, no metadata loss except fresh pending review. Add safe site sync CLI pulling a fixed public repo commit or taking local snapshot, verify manifest and stage replace. Add installation dedup parity, language, preview and release end-to-end tests. Independent whole-project review, then apply to user directory preserving Git and concurrent files.
5. Verify npm ci / npm run check / npm run build / release refusal tests and real 13/31/3 entries, 13/31/14 expanded installations; validate outputs using website contract. Document deployment prerequisites explicitly; do not claim cloud configured or push without instruction.
