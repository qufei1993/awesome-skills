---
# Editable template; use new:collection to generate the actual UUID and timestamps.
schemaVersion: 1
language: en
id: ""
slug: ""
revision: 1
status: active
sourceKind: editorial-selection
category: other
tags: []
provenance:
  selectionReason: ""
  evidence: []
# Maintainers verify createdAt, updatedAt, sourceKeys, fixed commits, and evidence checkedAt.
# Do not invent authors, licenses, test records, or an approved status.
review:
  status: pending
  notes: []
cover:
  kind: concept
  preset: neutral
  alt: Collection concept cover
---

# Collection title

Describe the specific task this collection addresses in one sentence.

## Overview

Explain the overall task, how the Skills work together, and why you selected them.

## Scenarios

- A specific scenario

## Usage

Describe the usage order, prerequisites, and decisions requiring human judgment.

## Skills

### Skill name

Describe this Skill's role and why it belongs in the collection.

```yaml
id: ""
entry:
  repo: ""
  entryPoint: ""
  # commit: full 40-character commit SHA verified by a maintainer
installationMode: skill
installationItems:
  - name: ""
    repo: ""
    directory: ""
    entryPoint: SKILL.md
    # commit and license require real evidence; do not label an unknown license MIT.
resourceCheck: needs-review
resourceNotes: Directory resources and installation environment still need verification.
```
