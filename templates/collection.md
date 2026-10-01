---
# 待编辑模板；使用 new:collection 生成实际 UUID 和时间。
schemaVersion: 1
language: zh
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
# createdAt、updatedAt、sourceKeys、固定 commit 与证据 checkedAt 由维护者核实。
# 不填写假的 author、许可、测试记录或 approved 状态。
review:
  status: pending
  notes: []
cover:
  kind: concept
  preset: neutral
  alt: 合集概念封面
---

# 合集标题

一句话说明这个合集解决什么问题。

## 概览

说明整体任务、各技能的衔接和选择依据。

## 适用场景

- 一个具体场景

## 使用建议

说明使用顺序、前提和需要人工判断的部分。

## Skills

### Skill 名称

说明此 Skill 的作用及它为何适合这个组合。

```yaml
id: ""
entry:
  repo: ""
  entryPoint: ""
  # commit: 维护者核对后的完整 40 位提交 SHA
installationMode: skill
installationItems:
  - name: ""
    repo: ""
    directory: ""
    entryPoint: SKILL.md
    # commit 和 license 必须有真实依据，不能把未知许可写成 MIT。
resourceCheck: needs-review
resourceNotes: 尚待逐项核对目录资源与安装环境。
```
