# Dev Agent Skills

Structure Git, GitHub, privacy checks, and skill authoring in Claude Code.

## Overview

The author publishes workflow plugins for commits, pull requests, decision records, public-repository privacy, and skill creation. This collection includes their complete Skill directories; the separate guardrails plugin supplies a hook.

## Scenarios

- Prepare Conventional Commits and pull requests
- Resolve review feedback and check merge readiness
- Record decisions and check public-repository privacy

## Usage

Use the upstream Claude Code plugins to retain their hooks. GitHub workflows need the GitHub CLI; privacy checks require a local denylist configured for the repository.

## Skills

- [plugins/decision-records/skills](https://github.com/fvadicamo/dev-agent-skills/tree/8e710c57b4aa34fec63752ccf04a47adb4a8be65/plugins/decision-records/skills)
- [plugins/github-workflow/skills](https://github.com/fvadicamo/dev-agent-skills/tree/8e710c57b4aa34fec63752ccf04a47adb4a8be65/plugins/github-workflow/skills)
- [plugins/privacy-guard/skills](https://github.com/fvadicamo/dev-agent-skills/tree/8e710c57b4aa34fec63752ccf04a47adb4a8be65/plugins/privacy-guard/skills)
- [plugins/skill-authoring/skills](https://github.com/fvadicamo/dev-agent-skills/tree/8e710c57b4aa34fec63752ccf04a47adb4a8be65/plugins/skill-authoring/skills)

## Source

https://github.com/fvadicamo/dev-agent-skills
