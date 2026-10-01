# Markdown 合集格式

人工只维护 `collections/<slug>/README.md` 及归档封面。JSON、索引和根 README 的 `<!-- catalog:start -->` / `<!-- catalog:end -->` 区域由生成器维护。

## 文件结构

文件顶部使用 YAML frontmatter 存机器字段。正文按以下顺序组织；英文标题的对应写法见[英文格式说明](format.md)：

| 层级 | 标题 | 内容 |
| --- | --- | --- |
| H1 | 合集标题 | 唯一标题，后接一段简介 |
| H2 | 概览 | 组合用途及搭配依据 |
| H2 | 适用场景 | 1–5 个列表项 |
| H2 | 使用建议 | 顺序、前提及注意事项 |
| H2 | `Skills` | 每个 Skill 使用一个 H3 |
| H3 | Skill 名称 | 一段用途摘要和一个 `yaml` 围栏 |

H1、简介、概览、场景、使用建议以及 Skill 名称与摘要来自正文，不在机器字段中重复维护。代码围栏内的 `#` 不会被视为正文标题。YAML 禁止重复键、别名、合并键和未知字段，避免含义不明确。

## 元数据

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 当前为 `1` |
| `language` | `zh` 或 `en`，供稿任选一种 |
| `id` | 新建时生成的 UUID v4，永久保留 |
| `slug` | 小写字母/数字及单个连字符组成的网址名称，与目录对应 |
| `revision` | 从 1 开始的正整数，接受内容变更时增加 |
| `createdAt`, `updatedAt` | UTC 时间；更新时间不得早于创建时间 |
| `sourceKeys` | 合集公开来源的稳定去重标识；保留历史来源 |
| `status` | `active` 或 `archived` |
| `sourceKind` | `author-repository`、`external-recommendation` 或 `editorial-selection` |
| `category` | `development`、`product`、`research`、`productivity`、`marketing`、`design`、`video`、`other` |
| `tags` | 至多 8 个标签 |
| `provenance` | 署名、策划理由、公开证据及可选作者仓库范围 |
| `cover` | 默认概念封面，或本目录中已归档的图片与授权证据 |
| `verification` | 来源、文件、安装和工作流的核验状态与记录 |
| `review` | 内容审核，与实测状态分开 |
| `sortOrder` | 可选的排序数字 |
| `curator` | 可选的合集策划者署名；与 Skill 原作者区别记录 |
| `localizations` | 迁移保留的英文展示字段；条目翻译引用原 Skill ID |

不要在草稿模板填随机的 commit、许可或审查人。pending 草稿可缺 `schemaVersion`、`id`、`revision`、时间、`sourceKeys`、审核/核验、证据核对日期及固定 commit 等维护字段；新建命令仍会生成真实稳定 UUID。供稿正文、公开出处、Skill ID、路径、安装项与许可记录仍须填写。生成器只在校验副本中补保守默认值，不写回假身份或核验结论；缺少官网合同所需字段的草稿不会进入预览数据并会被报告。模板里的空字符串是编辑提示，并非有效投稿。参考 [模板说明](../templates/README.zh.md) 的三个真实合集，不能原样复制它们的事实到新来源。

`provenance.author` 与 `provenance.recommender` 使用 `name`、`url`。公开推荐必须注明推荐者；原创策划必须填写 `selectionReason`；作者仓库型使用 `repositoryScope`，记录 `repo`、固定 `commit`、`directories` 与 `coverage: all-valid-skills`，条目须处于声明范围。

`provenance.evidence` 为证据列表，每项含 `id`、`kind`（`repository`/`article`/`post`）、`url`、`title`、`publisher`、`location`、`finding`、`checkedAt`、`supportsItemIds`，可选 `publishedAt`。证据须覆盖每个展示条目；明确区分公开推荐关系与实际核对的版本。

## 每个 Skill 的 YAML

每个 H3 下面独立放一个 YAML 围栏。它包含 `id`、`entry`、`installationMode`、`installationItems`、`resourceCheck`、`resourceNotes`，可选 `role`、`authors`、`originalDescription`。不要把所有 Skills 塞进 frontmatter 或共用一个安装清单。

- `entry`：`repo` 使用 GitHub `owner/repo`，`commit` 使用完整 40 位 SHA，`entryPoint` 指向仓库内的 `SKILL.md`。
- `installationMode: skill`：恰好一个安装项；`bundle`：至少两个。入口必须对应其中一个真实安装项。
- 每个安装项：`name`、`repo`、`commit`、`directory`、`entryPoint: SKILL.md`、`license`。`directory` 为仓库相对路径，仓库根用 `.`。不得使用绝对路径、`..` 或反斜杠。
- `license`：`identifier` 与可选 `evidenceUrl`。未知许可使用诚实记录（例如 `NOASSERTION`），不能据此宣称有使用授权。
- `resourceCheck`：`verified` 或 `needs-review`；`resourceNotes` 解释完整资源引用、依赖或尚待核对项。
- 可选 `authors`：每人使用 `name`、`evidenceUrl`；策划者不是所有 Skill 的原作者。

展示条目数与安装数可能不同。安装统计按 `(repo, commit, directory)` 去重；例如产品视频的 3 个展示条目展开为 14 个安装项，不能将 14 写成实测通过数。

## 审核、核验与封面

`review.status` 为 `pending`、`approved` 或 `rejected`。批准/拒绝还需要真实 `reviewer`、`reviewedAt`；`notes` 保留范围与理由。

`verification.source/files` 使用 `verified` 或 `needs-review`；`installation/workflow` 使用 `not-tested`、`passed` 或 `failed`。`checkedAt` 与 `notes` 记录核对范围。实际 `passed/failed` 必须有对应 Evidence，记录 `testedAt`、`versions`、`itemIds`、`resultRef`、`environment`。固定 commit 或 CI 通过不能代替这些证据。

默认使用概念封面，preset 支持 `design`、`engineering`、`marketing`、`video`、`neutral`。使用 `source-image` 时记录 `file`（合集目录内相对路径）、`sourceUrl`、`alt`、`rightsStatus` 及核实后的 `rightsEvidenceUrl`。可选尺寸、背景和位置只用于展示。归档图片只允许 PNG、JPEG、WebP、GIF，非空且不超过 5 MiB，内容格式须匹配，禁止路径逃逸或符号链接逃逸。图片附件须由维护者归档；CI 不下载远端图片。

## 投稿检查与正式导出

```sh
npm run check
npm run validate -- --base-dir BASE_CHECKOUT
npm run validate:publish -- --base-dir BASE_CHECKOUT
npm run build:preview -- --output dist/collections
npm run build -- --output dist/collections --source-revision FULL_COMMIT_SHA
```

投稿检查校验结构、路径、身份冲突和更新稳定性。正式检查对已批准记录要求固定版本、来源/文件/资源均已核实、无失败实测，以及可用且授权明确的封面。安装和工作流可以诚实保留 `not-tested`，不能包装成测试成功。待审记录不会导出到正式数据。

预览包含待审记录，manifest 标记 `preview: true`，禁止同步官网。当前三个迁移示例都为 pending；正式快照为空，不表示三个合集已经上线。维护者完成实际审核和所缺核验后再批准。翻译沿用合集与条目身份，缺少另一种语言时展示已有语言。

## 项目文档语言

项目文档与模板默认 `.md` 文件使用英文，中文另存同名 `.zh.md` 文件。每份文档的段落与标题表格只使用一种语言。修改时同步更新两份版本，链接指向对应语言文件；明确切换语言的说明链接除外。`AGENTS.md` 只保留一份简短英文规则文件，`CLAUDE.md` 引用它。
