import test from 'node:test';
import assert from 'node:assert/strict';
import { readSkillMetadata } from '../scripts/lib/skill-metadata.mjs';

// Frontmatter from the fixed commits audited on 2026-10-10; expectations retain author text.
const auditedFrontmatter = [
  {
    "repo": "xstongxue/best-skills",
    "commit": "9aa4e555950da6e43e7d98c5f0c7b70264204850",
    "entryPoint": "skills/office-file-process/SKILL.md",
    "source": "---\nname: office-file-process\ndescription: 处理 Office 文档的一站式 skill：Word(.doc/.docx/.dotx)、Excel(.xls/.xlsx/.xlsm/.csv)、PowerPoint(.ppt/.pptx/.potx) 的创建、读取、编辑、提取、转换、校验。触发：『读取 word 文档』『提取 excel 内容』『看 ppt 讲了什么』、.doc 老格式打不开、生成/编辑 Word 报告/合同/模板、制作幻灯片/deck/演示文稿、写带公式的电子表格。读取优先 pandoc/markitdown 等官方工具，环境没有则走 Windows Office COM 自动化（含中文文件名、PowerShell 编码等 Windows 环境方案）；创建/编辑用 docx-js、pptxgenjs、openpyxl 等。Use whenever any .docx/.xlsx/.pptx file is the primary input or output: create, read, edit, extract, convert, or validate it.\nlicense: Proprietary. LICENSE.txt has complete terms\n---\n\n# Original instructions are not executed.\n",
    "name": "office-file-process",
    "description": "处理 Office 文档的一站式 skill：Word(.doc/.docx/.dotx)、Excel(.xls/.xlsx/.xlsm/.csv)、PowerPoint(.ppt/.pptx/.potx) 的创建、读取、编辑、提取、转换、校验。触发：『读取 word 文档』『提取 excel 内容』『看 ppt 讲了什么』、.doc 老格式打不开、生成/编辑 Word 报告/合同/模板、制作幻灯片/deck/演示文稿、写带公式的电子表格。读取优先 pandoc/markitdown 等官方工具，环境没有则走 Windows Office COM 自动化（含中文文件名、PowerShell 编码等 Windows 环境方案）；创建/编辑用 docx-js、pptxgenjs、openpyxl 等。Use whenever any .docx/.xlsx/.pptx file is the primary input or output: create, read, edit, extract, convert, or validate it.",
    "normalizedField": "description"
  },
  {
    "repo": "Orkas-AI/Orkas-VideoStudio",
    "commit": "c0c3c3eac359f9a3e8e3fbe65fd5426fad03dc4b",
    "entryPoint": "packages/skills/stage-assemble/SKILL.md",
    "source": "---\nname: stage-assemble\ndescription: Deterministically assemble an approved cross-modal EDL (plan.json) into a finished video — produce each segment (edit/compose/generate/provided, delegated to its line), then assemble in ffmpeg tiers: concat primaries → overlay composed layers → mix narration once (coverage check) → burn captions → verify loudness; idempotent-resumable, with QA before the draft gate. Trigger after a plan is validated and approved; do NOT trigger to ingest or re-author the plan (stage-plan).\n---\n\n# Original instructions are not executed.\n",
    "name": "stage-assemble",
    "description": "Deterministically assemble an approved cross-modal EDL (plan.json) into a finished video — produce each segment (edit/compose/generate/provided, delegated to its line), then assemble in ffmpeg tiers: concat primaries → overlay composed layers → mix narration once (coverage check) → burn captions → verify loudness; idempotent-resumable, with QA before the draft gate. Trigger after a plan is validated and approved; do NOT trigger to ingest or re-author the plan (stage-plan).",
    "normalizedField": "description"
  },
  {
    "repo": "Orkas-AI/Orkas-VideoStudio",
    "commit": "c0c3c3eac359f9a3e8e3fbe65fd5426fad03dc4b",
    "entryPoint": "packages/skills/stage-plan/SKILL.md",
    "source": "---\nname: stage-plan\ndescription: The \"ingest + plan\" half of end-to-end video orchestration — ingest the user's material from evidence, then decompose intent into ONE cross-modal EDL (plan.json: edit/generate/compose/provided segments + narration/music/caption tracks + a delivery promise), validate it with `ovs plan validate`. Trigger when the deliverable spans more than one axis (AUTO line); do NOT trigger for a pure single-axis job (route to that line). The assembler half is stage-assemble.\n---\n\n# Original instructions are not executed.\n",
    "name": "stage-plan",
    "description": "The \"ingest + plan\" half of end-to-end video orchestration — ingest the user's material from evidence, then decompose intent into ONE cross-modal EDL (plan.json: edit/generate/compose/provided segments + narration/music/caption tracks + a delivery promise), validate it with `ovs plan validate`. Trigger when the deliverable spans more than one axis (AUTO line); do NOT trigger for a pure single-axis job (route to that line). The assembler half is stage-assemble.",
    "normalizedField": "description"
  },
  {
    "repo": "LambdaTest/agent-skills",
    "commit": "e2d7423a899f2bef8ccf53b3a6edd15465075684",
    "entryPoint": "kanecli-skill/SKILL.md",
    "source": "---\nname: kanecli-skill\ndescription: Browser automation + AI test authoring via kane-cli - run browser objectives, generate & refine test scenarios/cases from a description, design requirement-linked test suites from a PRD/spec (assurance), parse NDJSON output, inspect logs, save runnable _test.md. Use for any task requiring a real browser (navigate, click, fill forms, test web UI, take screenshots), or to author test cases, quick cases from a description via kane-cli generate; a designed, coverage-accounted suite from requirement documents via the assurance commands. Never write test cases by hand. Also runs mobile app tests - native Android app on a virtual emulator or iOS app on a simulator via --target emulator|simulator (desktop browser stays the default target): locally on macOS Apple Silicon, or on the LambdaTest cloud grid from any machine via kane-cli testrun run --remote. Also shares the assurance store (.context/) with a team through a location (a GitHub repository, an S3-compatible bucket, or a folder) via kane-cli context sync, and resolves the decisions a sync rebase asks.\n---\n\n# Original instructions are not executed.\n",
    "name": "kanecli-skill",
    "description": "Browser automation + AI test authoring via kane-cli - run browser objectives, generate & refine test scenarios/cases from a description, design requirement-linked test suites from a PRD/spec (assurance), parse NDJSON output, inspect logs, save runnable _test.md. Use for any task requiring a real browser (navigate, click, fill forms, test web UI, take screenshots), or to author test cases, quick cases from a description via kane-cli generate; a designed, coverage-accounted suite from requirement documents via the assurance commands. Never write test cases by hand. Also runs mobile app tests - native Android app on a virtual emulator or iOS app on a simulator via --target emulator|simulator (desktop browser stays the default target): locally on macOS Apple Silicon, or on the LambdaTest cloud grid from any machine via kane-cli testrun run --remote. Also shares the assurance store (.context/) with a team through a location (a GitHub repository, an S3-compatible bucket, or a folder) via kane-cli context sync, and resolves the decisions a sync rebase asks.",
    "normalizedField": "description"
  },
  {
    "repo": "OneWave-AI/claude-skills",
    "commit": "fc5b7851a6c7ba367e05797df46ad3679df355dd",
    "entryPoint": "content-repurposer/SKILL.md",
    "source": "---\nname: content-repurposer\ndescription: Master skill that transforms ANY content into 8+ formats: slides, infographic, video script, podcast, social posts, email series, flashcards, quiz, one-pager, interactive game.\n---\n\n# Original instructions are not executed.\n",
    "name": "content-repurposer",
    "description": "Master skill that transforms ANY content into 8+ formats: slides, infographic, video script, podcast, social posts, email series, flashcards, quiz, one-pager, interactive game.",
    "normalizedField": "description"
  },
  {
    "repo": "OneWave-AI/claude-skills",
    "commit": "fc5b7851a6c7ba367e05797df46ad3679df355dd",
    "entryPoint": "cowork-sop-writer/SKILL.md",
    "source": "---\nname: cowork-sop-writer\ndescription: Turn a process walkthrough -- meeting transcript, screen-recording transcript, rough notes, or a folder of scattered how-to docs -- into a clean standard operating procedure: numbered steps, roles, decision points, exceptions, and a consistent template across your whole SOP library.\ntools: Read, Glob, Grep, Write, Bash\nmodel: inherit\n---\n\n# Original instructions are not executed.\n",
    "name": "cowork-sop-writer",
    "description": "Turn a process walkthrough -- meeting transcript, screen-recording transcript, rough notes, or a folder of scattered how-to docs -- into a clean standard operating procedure: numbered steps, roles, decision points, exceptions, and a consistent template across your whole SOP library.",
    "normalizedField": "description"
  },
  {
    "repo": "OneWave-AI/claude-skills",
    "commit": "fc5b7851a6c7ba367e05797df46ad3679df355dd",
    "entryPoint": "debate-simulator/SKILL.md",
    "source": "---\nname: debate-simulator\ndescription: Spin up 2-3 expert personas to debate any topic from different angles. Structure: Opening statements, rebuttals, cross-examination, closing arguments.\n---\n\n# Original instructions are not executed.\n",
    "name": "debate-simulator",
    "description": "Spin up 2-3 expert personas to debate any topic from different angles. Structure: Opening statements, rebuttals, cross-examination, closing arguments.",
    "normalizedField": "description"
  },
  {
    "repo": "OneWave-AI/claude-skills",
    "commit": "fc5b7851a6c7ba367e05797df46ad3679df355dd",
    "entryPoint": "flashcard-generator/SKILL.md",
    "source": "---\nname: flashcard-generator\ndescription: Extract key concepts from any content and create spaced-repetition flashcards. Multiple formats: Anki-compatible, printable PDFs, interactive web.\n---\n\n# Original instructions are not executed.\n",
    "name": "flashcard-generator",
    "description": "Extract key concepts from any content and create spaced-repetition flashcards. Multiple formats: Anki-compatible, printable PDFs, interactive web.",
    "normalizedField": "description"
  },
  {
    "repo": "OneWave-AI/claude-skills",
    "commit": "fc5b7851a6c7ba367e05797df46ad3679df355dd",
    "entryPoint": "game-builder/SKILL.md",
    "source": "---\nname: game-builder\ndescription: Convert any topic into playable browser games. Types: trivia, matching, word puzzles, adventure games. Uses Phaser.js or Kaboom.js.\n---\n\n# Original instructions are not executed.\n",
    "name": "game-builder",
    "description": "Convert any topic into playable browser games. Types: trivia, matching, word puzzles, adventure games. Uses Phaser.js or Kaboom.js.",
    "normalizedField": "description"
  },
  {
    "repo": "OneWave-AI/claude-skills",
    "commit": "fc5b7851a6c7ba367e05797df46ad3679df355dd",
    "entryPoint": "game-recap-generator/SKILL.md",
    "source": "---\nname: game-recap-generator\ndescription: Convert game stats and highlights into engaging recaps. Multiple styles: Twitter thread, Instagram carousel, blog post, newsletter.\n---\n\n# Original instructions are not executed.\n",
    "name": "game-recap-generator",
    "description": "Convert game stats and highlights into engaging recaps. Multiple styles: Twitter thread, Instagram carousel, blog post, newsletter.",
    "normalizedField": "description"
  },
  {
    "repo": "OneWave-AI/claude-skills",
    "commit": "fc5b7851a6c7ba367e05797df46ad3679df355dd",
    "entryPoint": "hyperframes-local-promo/SKILL.md",
    "source": "---\nname: hyperframes-local-promo\ndescription: Build promo videos for local businesses in HyperFrames -- the new-menu drop, the seasonal offer, the event announcement, the \"we're hiring\" post, the Google Business Profile clip. Restaurant, salon, gym, trades: 15-30 seconds, brand-clean, captioned, sized for Instagram, Facebook, and the profile.\ntools: Read, Write, Bash, Glob, Grep, WebSearch, WebFetch, Agent\nmodel: inherit\n---\n\n# Original instructions are not executed.\n",
    "name": "hyperframes-local-promo",
    "description": "Build promo videos for local businesses in HyperFrames -- the new-menu drop, the seasonal offer, the event announcement, the \"we're hiring\" post, the Google Business Profile clip. Restaurant, salon, gym, trades: 15-30 seconds, brand-clean, captioned, sized for Instagram, Facebook, and the profile.",
    "normalizedField": "description"
  },
  {
    "repo": "OneWave-AI/claude-skills",
    "commit": "fc5b7851a6c7ba367e05797df46ad3679df355dd",
    "entryPoint": "hypothesis-testing-engine/SKILL.md",
    "source": "---\nname: hypothesis-testing-engine\ndescription: Take any claim and design + execute a complete research protocol to test it. Apply scientific method automatically: design study, gather data, run analysis, provide verdict with confidence level.\n---\n\n# Original instructions are not executed.\n",
    "name": "hypothesis-testing-engine",
    "description": "Take any claim and design + execute a complete research protocol to test it. Apply scientific method automatically: design study, gather data, run analysis, provide verdict with confidence level.",
    "normalizedField": "description"
  },
  {
    "repo": "OneWave-AI/claude-skills",
    "commit": "fc5b7851a6c7ba367e05797df46ad3679df355dd",
    "entryPoint": "motion-language-designer/SKILL.md",
    "source": "---\nname: motion-language-designer\ndescription: Define a product's motion design language -- duration and easing scales, choreography rules, and signature moves -- and export it as tokens plus ready-to-use Framer Motion variants and CSS. The difference between animations and a motion system: everything moves like it belongs to the same product.\ntools: Read, Glob, Grep, Write, Edit, Bash\nmodel: inherit\n---\n\n# Original instructions are not executed.\n",
    "name": "motion-language-designer",
    "description": "Define a product's motion design language -- duration and easing scales, choreography rules, and signature moves -- and export it as tokens plus ready-to-use Framer Motion variants and CSS. The difference between animations and a motion system: everything moves like it belongs to the same product.",
    "normalizedField": "description"
  },
  {
    "repo": "OneWave-AI/claude-skills",
    "commit": "fc5b7851a6c7ba367e05797df46ad3679df355dd",
    "entryPoint": "play-by-play-generator/SKILL.md",
    "source": "---\nname: play-by-play-generator\ndescription: Create realistic play-by-play commentary. Multiple announcer styles: traditional, hyped, analytical, homer. Color commentary included.\n---\n\n# Original instructions are not executed.\n",
    "name": "play-by-play-generator",
    "description": "Create realistic play-by-play commentary. Multiple announcer styles: traditional, hyped, analytical, homer. Color commentary included.",
    "normalizedField": "description"
  },
  {
    "repo": "OneWave-AI/claude-skills",
    "commit": "fc5b7851a6c7ba367e05797df46ad3679df355dd",
    "entryPoint": "rep-performance-scorecard/SKILL.md",
    "source": "---\nname: rep-performance-scorecard\ndescription: Multi-dimensional rep evaluation: activity, conversion, velocity, deal size. Peer benchmarking and coaching priority identification.\n---\n\n# Original instructions are not executed.\n",
    "name": "rep-performance-scorecard",
    "description": "Multi-dimensional rep evaluation: activity, conversion, velocity, deal size. Peer benchmarking and coaching priority identification.",
    "normalizedField": "description"
  },
  {
    "repo": "fal-ai-community/skills",
    "commit": "9ca850412943251fc9a466c4c29fdaf7a303a3d8",
    "entryPoint": "skills/fal-workflow/SKILL.md",
    "source": "---\nname: fal-workflow\ndescription: Author and execute multi-step media pipelines on fal.ai. Two modes: (A) declarative workflow JSON files for the fal.ai workflow runtime (\"create workflow\", \"chain models\", \"image to video pipeline\"); (B) imperative genmedia CLI orchestration when scripting locally (\"design pipeline\", \"fan-out generation\", \"frame bridging\", \"narrated video\", \"dataset generation\").\nmetadata:\n author: fal-ai\n version: \"4.0.0\"\n---\n\n# Original instructions are not executed.\n",
    "name": "fal-workflow",
    "description": "Author and execute multi-step media pipelines on fal.ai. Two modes: (A) declarative workflow JSON files for the fal.ai workflow runtime (\"create workflow\", \"chain models\", \"image to video pipeline\"); (B) imperative genmedia CLI orchestration when scripting locally (\"design pipeline\", \"fan-out generation\", \"frame bridging\", \"narrated video\", \"dataset generation\").",
    "normalizedField": "description"
  },
  {
    "repo": "daxaur/openpaw",
    "commit": "a2562d1c5cb236c1e81bb550cb1045ee5302b2c0",
    "entryPoint": "skills/c-secrets/SKILL.md",
    "source": "---\nname: c-secrets\ndescription: Look up and manage secrets using 1Password CLI (`op`) or Bitwarden CLI (`bw`). Retrieve passwords, generate new passwords, and copy credentials to clipboard. CRITICAL: Never display passwords in plain text — always copy to clipboard.\ntags: [passwords, secrets, 1password, bitwarden, credentials, security]\n---\n\n# Original instructions are not executed.\n",
    "name": "c-secrets",
    "description": "Look up and manage secrets using 1Password CLI (`op`) or Bitwarden CLI (`bw`). Retrieve passwords, generate new passwords, and copy credentials to clipboard. CRITICAL: Never display passwords in plain text — always copy to clipboard.",
    "normalizedField": "description"
  },
  {
    "repo": "monte-carlo-data/mc-agent-toolkit",
    "commit": "5b3da20ec03426afc8e3b4b914f6c33a82bc86ba",
    "entryPoint": "skills/onboarding/SKILL.md",
    "source": "---\nname: monte-carlo-onboarding\ndescription: Connect warehouses and BI tools (Tableau, Looker, Power BI) to Monte Carlo with API v2 tools: show what exists, reference credentials, create, validate and fix connections. Use to connect or onboard platforms, or to generate Terraform or a script.\nmetadata:\n  bucket: Setup\n---\n\n# Original instructions are not executed.\n",
    "name": "monte-carlo-onboarding",
    "description": "Connect warehouses and BI tools (Tableau, Looker, Power BI) to Monte Carlo with API v2 tools: show what exists, reference credentials, create, validate and fix connections. Use to connect or onboard platforms, or to generate Terraform or a script.",
    "normalizedField": "description"
  },
  {
    "repo": "eduardo-sl/go-agent-skills",
    "commit": "50133c33a386041f821389eaef19cdcfa3ac02d7",
    "entryPoint": "skills/(architecture)/go-architecture-review/SKILL.md",
    "source": "---\nname: go-architecture-review\ndescription: >\n  Review Go project architecture: package structure, dependency direction,\n  layering, separation of concerns, domain modeling, and module boundaries.\n  Use when reviewing architecture, designing package layout, evaluating\n  dependency graphs, or refactoring monoliths into modules. Trigger\n  examples: \"review architecture\", \"package structure\", \"project layout\",\n  \"dependency direction\", \"clean architecture Go\", \"module boundaries\".\n  Not for: code-level style (go-coding-standards), endpoint design\n  (go-api-design).\nuser-invocable: true\nlicense: MIT\ncompatibility: Designed for Claude Code or similar AI coding agents working on Go projects. Requires the Go toolchain. Read-only: this skill reports findings, it does not edit code.\nallowed-tools: Read Glob Grep Bash(go:*) Bash(gofmt:*)\nmetadata:\n  author: eduardo-sl\n  version: \"1.2.1\"\n---\n\n# Original instructions are not executed.\n",
    "name": "go-architecture-review",
    "description": "Review Go project architecture: package structure, dependency direction, layering, separation of concerns, domain modeling, and module boundaries. Use when reviewing architecture, designing package layout, evaluating dependency graphs, or refactoring monoliths into modules. Trigger examples: \"review architecture\", \"package structure\", \"project layout\", \"dependency direction\", \"clean architecture Go\", \"module boundaries\". Not for: code-level style (go-coding-standards), endpoint design (go-api-design).\n",
    "normalizedField": "compatibility",
    "compatibility": "Designed for Claude Code or similar AI coding agents working on Go projects. Requires the Go toolchain. Read-only: this skill reports findings, it does not edit code."
  },
  {
    "repo": "eduardo-sl/go-agent-skills",
    "commit": "50133c33a386041f821389eaef19cdcfa3ac02d7",
    "entryPoint": "skills/(code-quality)/go-code-review/SKILL.md",
    "source": "---\nname: go-code-review\ndescription: >\n  Comprehensive code review checklist for Go projects. Evaluates code\n  quality, idiomatic patterns, error handling, naming, package structure,\n  and test coverage. Use when reviewing Go code, PRs, or before merging\n  changes. Trigger examples: \"review this code\", \"check this PR\", \"code\n  review\", \"review Go file\".\n  Not for: security audits (go-security-audit), performance analysis\n  (go-performance-review).\nuser-invocable: true\nlicense: MIT\ncompatibility: Designed for Claude Code or similar AI coding agents working on Go projects. Requires the Go toolchain. Read-only: this skill reports findings, it does not edit code.\nallowed-tools: Read Glob Grep Bash(go:*) Bash(gofmt:*) Bash(golangci-lint:*)\nmetadata:\n  author: eduardo-sl\n  version: \"1.3.1\"\n---\n\n# Original instructions are not executed.\n",
    "name": "go-code-review",
    "description": "Comprehensive code review checklist for Go projects. Evaluates code quality, idiomatic patterns, error handling, naming, package structure, and test coverage. Use when reviewing Go code, PRs, or before merging changes. Trigger examples: \"review this code\", \"check this PR\", \"code review\", \"review Go file\". Not for: security audits (go-security-audit), performance analysis (go-performance-review).\n",
    "normalizedField": "compatibility",
    "compatibility": "Designed for Claude Code or similar AI coding agents working on Go projects. Requires the Go toolchain. Read-only: this skill reports findings, it does not edit code."
  },
  {
    "repo": "eduardo-sl/go-agent-skills",
    "commit": "50133c33a386041f821389eaef19cdcfa3ac02d7",
    "entryPoint": "skills/(safety)/go-security-audit/SKILL.md",
    "source": "---\nname: go-security-audit\ndescription: >\n  Security review for Go applications: input validation, SQL injection,\n  authentication/authorization, secrets management, TLS, OWASP Top 10, and\n  secure coding patterns. Use when performing security reviews, checking for\n  vulnerabilities, hardening Go services, or reviewing auth implementations.\n  Trigger examples: \"security review\", \"check vulnerabilities\", \"OWASP\",\n  \"SQL injection\", \"input validation\", \"secrets management\", \"auth review\".\n  Not for: dependency CVEs (go-dependency-audit), concurrency safety\n  (go-concurrency-review).\nuser-invocable: true\nlicense: MIT\ncompatibility: Designed for Claude Code or similar AI coding agents working on Go projects. Requires the Go toolchain. govulncheck, gosec and gitleaks are optional. Read-only: this skill reports findings, it does not edit code.\nallowed-tools: Read Glob Grep Bash(go:*) Bash(gofmt:*) Bash(govulncheck:*) Bash(gosec:*) Bash(gitleaks:*)\nmetadata:\n  author: eduardo-sl\n  version: \"1.4.0\"\n---\n\n# Original instructions are not executed.\n",
    "name": "go-security-audit",
    "description": "Security review for Go applications: input validation, SQL injection, authentication/authorization, secrets management, TLS, OWASP Top 10, and secure coding patterns. Use when performing security reviews, checking for vulnerabilities, hardening Go services, or reviewing auth implementations. Trigger examples: \"security review\", \"check vulnerabilities\", \"OWASP\", \"SQL injection\", \"input validation\", \"secrets management\", \"auth review\". Not for: dependency CVEs (go-dependency-audit), concurrency safety (go-concurrency-review).\n",
    "normalizedField": "compatibility",
    "compatibility": "Designed for Claude Code or similar AI coding agents working on Go projects. Requires the Go toolchain. govulncheck, gosec and gitleaks are optional. Read-only: this skill reports findings, it does not edit code."
  },
  {
    "repo": "eduardo-sl/go-agent-skills",
    "commit": "50133c33a386041f821389eaef19cdcfa3ac02d7",
    "entryPoint": "skills/(workflow)/go-dependency-audit/SKILL.md",
    "source": "---\nname: go-dependency-audit\ndescription: >\n  Audit Go module dependencies: detect outdated packages, check for known\n  vulnerabilities, review go.mod hygiene, identify unused or redundant deps,\n  and evaluate dependency quality. Use when auditing dependencies, checking\n  for CVEs, cleaning up go.mod, upgrading modules, or evaluating third-party\n  packages. Trigger examples: \"check dependencies\", \"audit deps\", \"go.mod\n  review\", \"update modules\", \"vulnerability scan\", \"govulncheck\".\n  Not for: code-level security (go-security-audit), architecture review\n  (go-architecture-review).\nuser-invocable: true\nlicense: MIT\ncompatibility: Designed for Claude Code or similar AI coding agents working on Go projects. Requires the Go toolchain. Requires network access to proxy.golang.org. Read-only: this skill reports findings, it does not edit code.\nallowed-tools: Read Glob Grep Bash(go:*) Bash(gofmt:*) Bash(govulncheck:*)\nmetadata:\n  author: eduardo-sl\n  version: \"1.1.1\"\n---\n\n# Original instructions are not executed.\n",
    "name": "go-dependency-audit",
    "description": "Audit Go module dependencies: detect outdated packages, check for known vulnerabilities, review go.mod hygiene, identify unused or redundant deps, and evaluate dependency quality. Use when auditing dependencies, checking for CVEs, cleaning up go.mod, upgrading modules, or evaluating third-party packages. Trigger examples: \"check dependencies\", \"audit deps\", \"go.mod review\", \"update modules\", \"vulnerability scan\", \"govulncheck\". Not for: code-level security (go-security-audit), architecture review (go-architecture-review).\n",
    "normalizedField": "compatibility",
    "compatibility": "Designed for Claude Code or similar AI coding agents working on Go projects. Requires the Go toolchain. Requires network access to proxy.golang.org. Read-only: this skill reports findings, it does not edit code."
  },
  {
    "repo": "mycelium-hq/ai-brain-starter",
    "commit": "c15ea9760277357d42602f55c20a5a2c9396b968",
    "entryPoint": "skills/cierre-de-llamada/SKILL.md",
    "source": "---\nname: cierre-de-llamada\ndescription: Use when a SALES or CLIENT call just ended and the follow-up needs to be produced from its transcript. Triggers: /cierre, \"close out this call\", \"acabo de tener una llamada\", \"arma el seguimiento\", \"what's the follow-up on this call\", \"qué sigue con este cliente\", or the user pastes a sales-call transcript. Produces seven blocks: CRM summary, deal state, tasks, follow-up email draft, reminder, note to the sales lead, and what worked / what did not. NOT for internal team meetings (use meeting-todos) and NOT for personal notes (use note-todos).\n---\n\n# Original instructions are not executed.\n",
    "name": "cierre-de-llamada",
    "description": "Use when a SALES or CLIENT call just ended and the follow-up needs to be produced from its transcript. Triggers: /cierre, \"close out this call\", \"acabo de tener una llamada\", \"arma el seguimiento\", \"what's the follow-up on this call\", \"qué sigue con este cliente\", or the user pastes a sales-call transcript. Produces seven blocks: CRM summary, deal state, tasks, follow-up email draft, reminder, note to the sales lead, and what worked / what did not. NOT for internal team meetings (use meeting-todos) and NOT for personal notes (use note-todos).",
    "normalizedField": "description"
  },
  {
    "repo": "VoltAgent/skills",
    "commit": "066b137c520a8739a899e160516d1f4044add7f3",
    "entryPoint": "skills/voltagent-core-reference/SKILL.md",
    "source": "---\nname: voltagent-core-reference\n# prettier-ignore\ndescription: Reference for the VoltAgent class: constructor options, lifecycle methods, and runtime behavior.\nlicense: MIT\nmetadata:\n  author: VoltAgent\n  version: \"1.0.0\"\n  repository: https://github.com/VoltAgent/skills\n---\n\n# Original instructions are not executed.\n",
    "name": "voltagent-core-reference",
    "description": "Reference for the VoltAgent class: constructor options, lifecycle methods, and runtime behavior.",
    "normalizedField": "description"
  },
  {
    "repo": "iart-ai/ecommerce-video-skills",
    "commit": "2bd0dd19c9b2df5230f5d8f7453861b9681e49b4",
    "entryPoint": "skills/product-demo-video/SKILL.md",
    "source": "---\nname: product-demo-video\ndescription: This skill should be used when the user asks to \"make a product demo video\", \"create an app demo video\", \"build a feature announcement video\", \"do a SaaS demo\", \"make a UI walkthrough video\", \"animate product screenshots into a demo\", \"add an animated cursor/click to a screenshot\", or \"zoom into part of a UI\". Covers turning static screenshots/designs (not screen recordings) into a clean animated demo: device/browser frames, animated cursor + click ripple, zoom/pan to focal UI, callout annotations, step pacing, screen-to-screen transitions, and feature captions.\nversion: 0.1.0\n---\n\n# Original instructions are not executed.\n",
    "name": "product-demo-video",
    "description": "This skill should be used when the user asks to \"make a product demo video\", \"create an app demo video\", \"build a feature announcement video\", \"do a SaaS demo\", \"make a UI walkthrough video\", \"animate product screenshots into a demo\", \"add an animated cursor/click to a screenshot\", or \"zoom into part of a UI\". Covers turning static screenshots/designs (not screen recordings) into a clean animated demo: device/browser frames, animated cursor + click ripple, zoom/pan to focal UI, callout annotations, step pacing, screen-to-screen transitions, and feature captions.",
    "normalizedField": "description"
  },
  {
    "repo": "connerkward/deterministic-design-skill",
    "commit": "88658fe9cf9bcc3d66ac4778f263fb677ec6ec43",
    "entryPoint": "design-spatial/SKILL.md",
    "source": "---\nname: design-spatial\ndescription: Spatial composition and layout for frontend design. Load with design when composing pages/dashboards/components, or whenever generated UI looks off — overlapping/colliding elements, weak hierarchy, or generic (\"looks like every startup site\"). The core idea: a model can't trust its own layout, so render it, critique it with fresh eyes, and deviate from your first instinct.\nauthor: Conner K Ward\n---\n\n# Original instructions are not executed.\n",
    "name": "design-spatial",
    "description": "Spatial composition and layout for frontend design. Load with design when composing pages/dashboards/components, or whenever generated UI looks off — overlapping/colliding elements, weak hierarchy, or generic (\"looks like every startup site\"). The core idea: a model can't trust its own layout, so render it, critique it with fresh eyes, and deviate from your first instinct.",
    "normalizedField": "description"
  },
  {
    "repo": "jiawood2006/hermes-skills",
    "commit": "f5c1376e6f924aec924661eca5326e8a85aa54cc",
    "entryPoint": "skills/ai-video-ad-production/SKILL.md",
    "source": "---\nname: ai-video-ad-production\ndescription: AI 电商视频广告生产线：一条命令出带货短视频（产品锁 / 多引擎选型 / 官方真像素产品镜 / 自动装配）。One-command product ad video pipeline: product lock, multi-engine selection, official-pixel product inserts, auto overlay assembly.\ncategory: ecommerce\n---\n\n# Original instructions are not executed.\n",
    "name": "ai-video-ad-production",
    "description": "AI 电商视频广告生产线：一条命令出带货短视频（产品锁 / 多引擎选型 / 官方真像素产品镜 / 自动装配）。One-command product ad video pipeline: product lock, multi-engine selection, official-pixel product inserts, auto overlay assembly.",
    "normalizedField": "description"
  }
];

for (const fixture of auditedFrontmatter) {
  test(`reads original single-line text from ${fixture.repo}:${fixture.entryPoint}`, () => {
    const value = readSkillMetadata(fixture.source, fixture.entryPoint);
    assert.equal(value.name, fixture.name);
    assert.equal(value.description, fixture.description);
    assert.deepEqual(value.normalizedFields, [fixture.normalizedField]);
    if (fixture.compatibility !== undefined) assert.equal(value.compatibility, fixture.compatibility);
  });
}

const skill = frontmatter => `---\n${frontmatter}\n---\n\n# Skill\n`;

test('preserves strict YAML string semantics and reports no normalization', () => {
  const value = readSkillMetadata('\uFEFF' + skill('name: sample\ndescription: "Use API: read\\nthen write"\ncompatibility: "Requires Node: v22"').replaceAll('\n', '\r\n'), 'sample/SKILL.md');
  assert.deepEqual(value, { name: 'sample', description: 'Use API: read\nthen write', compatibility: 'Requires Node: v22', normalizedFields: [] });
});

test('keeps author namespace and path punctuation as display names', () => {
  const value = readSkillMetadata(skill('name: "harness:setup/path\\\\component"\ndescription: Setup the project.'), 'setup/SKILL.md');
  assert.equal(value.name, 'harness:setup/path\\component');
  assert.deepEqual(value.normalizedFields, []);
});

test('preserves literal backslashes, quotes, Unicode and colon text during normalization', () => {
  const value = readSkillMetadata(skill('name: sample\ndescription: Read paths: C:\\work\\skill, "quoted text", 文本。\ncompatibility: Requires Node: v22'), 'sample/SKILL.md');
  assert.equal(value.description, 'Read paths: C:\\work\\skill, "quoted text", 文本。');
  assert.equal(value.compatibility, 'Requires Node: v22');
  assert.deepEqual(value.normalizedFields, ['description', 'compatibility']);
});

test('normalizes text without reinterpreting escapes in an unquoted scalar', () => {
  const value = readSkillMetadata(skill('name: sample\ndescription: Example filename: shell.php\\0.jpg'), 'sample/SKILL.md');
  assert.equal(value.description, 'Example filename: shell.php\\0.jpg');
  assert.ok(!value.description.includes('\0'));
});

for (const [label, frontmatter] of [
  ['duplicate names', 'name: first\nname: second\ndescription: Use API: read'],
  ['duplicate descriptions', 'name: sample\ndescription: Use API: read\ndescription: Use API: write'],
  ['duplicate nested keys', 'name: sample\ndescription: Use API: read\nmetadata:\n  author: first\n  author: second'],
  ['anchors', 'name: &author sample\ndescription: Use API: read'],
  ['aliases', 'name: sample\ndescription: Use API: read\nmetadata: *author'],
  ['merge keys', 'name: sample\ndescription: Use API: read\n<<: { author: first }'],
  ['complex mapping keys', 'name: sample\ndescription: Use API: read\n? [first, second]\n: extra'],
  ['non-string mapping keys', 'name: sample\ndescription: Use API: read\nmetadata:\n  1: first'],
  ['unresolved tags', 'name: sample\ndescription: Use API: read\nmetadata: !custom text'],
  ['inline comments with ambiguous text', 'name: sample\ndescription: Use API: read # this may be a comment'],
  ['indented plain scalar continuations', 'name: sample\ndescription: Use API: read\n  then write'],
  ['indented mapping structures', 'name: sample\ndescription: Use API: read\n  mode: write'],
  ['a sequence as description', 'name: sample\ndescription: [first, second]'],
  ['a mapping as description', 'name: sample\ndescription:\n  nested: useful'],
  ['an inline structure after a colon', 'name: sample\ndescription: Options: { first: second }'],
  ['an anchor after a colon', 'name: sample\ndescription: Use API: &value read'],
  ['an alias after a colon', 'name: sample\ndescription: Use API: *value'],
  ['an unterminated quoted string', 'name: sample\ndescription: "Use API: read'],
  ['an invalid non-text field', 'name: sample\ndescription: Useful work.\nmetadata: Mode: read'],
  ['missing name', 'description: Use API: read'],
  ['missing description', 'name: sample\ncompatibility: Requires Node: v22'],
  ['non-text name', 'name: 123\ndescription: Useful work.'],
  ['non-text description', 'name: sample\ndescription: true'],
  ['empty description', 'name: sample\ndescription: "   "'],
  ['parsed NUL in quoted description', 'name: sample\ndescription: "Null byte filename shell.php\\0.jpg"'],
  ['other escaped control characters', 'name: sample\ndescription: "Use \\x01 characters"'],
  ['a control character in another field', 'name: sample\ndescription: Use API: read\nmetadata:\n  value: "\\u0001"'],
  ['control characters in names', 'name: "unsafe\\nname"\ndescription: Useful work.'],
  ['raw controls in normalization candidates', 'name: sample\ndescription: Use API: read\u0001'],
]) {
  test(`rejects ${label} without guessing or weakening frontmatter boundaries`, () => {
    assert.throws(() => readSkillMetadata(skill(frontmatter), 'sample/SKILL.md'), /upstream:.*frontmatter/);
  });
}

test('rejects instructions without an opening frontmatter block', () => {
  assert.throws(() => readSkillMetadata('# Skill\nname: sample\ndescription: Useful work.', 'sample/SKILL.md'), /must start with YAML frontmatter/);
});
