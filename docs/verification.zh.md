# 三个现有合集的迁移验证

本次范围为 Taste Skill、Skills for Real Engineers 与产品宣传视频。产品营销与增长未纳入本阶段迁移。原官网 JSON 作为不可修改的对照保存在 `tests/fixtures/site/`，人工内容源已转换为各合集目录中的 `README.md`。初次迁移的 Markdown 与封面固定保存在 `tests/fixtures/migrated/collections/`，精确迁移回归仅使用这份历史夹具；实际 `collections/` 目录允许新增投稿、正常修订及后续审批，不受历史三合集数量或审核状态断言限制。

## 保留内容与审核边界

迁移保留合集 UUID、slug、revision、创建及更新时间、历史来源标识、出处证据、条目 ID、固定 commit、安装目录、许可证记录、正文和英文翻译。`tests/migration.test.mjs` 将固定历史夹具解析后的完整文档逐字段与原 JSON 比较，新增实际策划署名 `curator`，并允许以下审核差异：

- `review.status` 从 `approved` 改为 `pending`。
- 原 `review.notes` 保留，追加“新仓库接入等待来源、资源与封面审核”。
- 移除此前展示迁移审批的 `reviewer` 与 `reviewedAt`。

此前批准只覆盖官网展示迁移，不能自动成为新仓库接入或来源、资源、封面使用权的批准。迁移不增加版本，也不把固定 commit、格式检查或公开案例改写成实测成功。

这三份合集文档采用中文主内容，保留 `localizations.en`。`language: zh` 与 `cover.file` 是 Markdown 管理字段，不进入官网 JSON 文档。`curator: {name: Skills Hub, url: https://github.com/qufei1993/awesome-skills}` 是真实策划署名，会进入导出 JSON 并用于索引展示，独立于 Skill 原作者及公开推荐者。没有提供署名的原始 JSON 不会自动新增策划者。

## 安装统计与封面

| 合集 | 展示条目 | 去重安装项 | 封面 |
| --- | ---: | ---: | --- |
| Taste Skill | 13 | 13 | `collections/taste/cover.webp` |
| Skills for Real Engineers | 31 | 31 | `collections/engineering/cover.png` |
| 产品宣传视频 | 3 | 14 | 原 `video` 概念封面 |

安装项按 `(repo, commit, directory)` 去重。14 个安装项是产品视频组合条目展开后的统计，不是实测次数。两张来源图片复制自官网已有归档素材；Markdown 解析保留原 `cover.url`，生成预览快照时才将 URL 改为对应快照中的归档路径。回归检查导出图片字节与迁移源图片一致，且索引和详情来自同一批记录。

## 尚未完成的核验

| 合集 | 来源 | 文件与资源 | 安装 | 工作流 | 来源封面使用权 |
| --- | --- | --- | --- | --- | --- |
| Taste Skill | `verified`（沿用原记录） | `needs-review` | `not-tested` | `not-tested` | `needs-review` |
| Skills for Real Engineers | `needs-review` | `needs-review` | `not-tested` | `not-tested` | `needs-review` |
| 产品宣传视频 | `verified`（沿用原记录） | `needs-review` | `not-tested` | `not-tested` | 概念封面，不宣称为案例成片 |

原始核验说明、证据范围和许可证记录均保留。本任务未重新下载每个上游入口，未检查全部资源引用、目录外依赖或安装环境，未安装或运行任何第三方 Skill，也未制作案例视频。维护者需要完成真实核验、确认来源封面使用依据并重新审核，之后才能批准正式收录。

## 可复现检查

```sh
node --test tests/markdown.test.mjs tests/migration.test.mjs
npm test
npm run validate
npm run build:preview
npm run build
```

解析器测试先在实现缺失时失败，再验证三份原 JSON 无损往返；额外边界测试覆盖 YAML 严格解析、正文结构、图片、代码围栏和翻译字段。迁移回归先在 `collections/` 尚未创建时失败，再运行真实 Markdown 与生成快照的集成检查。

集成回归使用固定历史夹具的临时副本，验证这份迁移快照的预览包含 3 个合集、展示数为 13/31/3、去重安装数为 13/31/14，并用官网原数据契约重新校验每份导出详情与索引。该历史快照的正式构建必须导出 0 个合集，因为三份历史内容都处于 `pending`；这是迁移时点的验证结果，不限制实际目录后来经过审核的正式收录。额外回归会在临时实际目录中合法新增第四个草稿、修订 Taste 文案及版本，然后重新运行历史迁移检查，确保正常贡献不被固定断言阻挡。

2026-10-01 本次实际执行 `node --test tests/migration.test.mjs` 为 2/2 通过，随后 `npm test` 为 53/53 通过。真实迁移回归曾发现工程合集原有 `cover.background: "#fff"` 被新增检查误拒绝；检查已修正为接受合法的三位或六位十六进制颜色，原数据未改写。

同日收尾将迁移断言切换为固定历史夹具，并补充策划者的 JSON 正规化与保留。两项回归先分别因署名丢失、第四个草稿触发固定目录断言而失败；修正后解析器与迁移测试 29/29 通过，全项目测试 65/65 通过。迁移测试新增的临时社区投稿及文案修订均通过实际提交校验，并且不会影响固定历史快照的回归结果。

检查通过只证明迁移和生成符合约定。Cloudflare 部署、公开仓库推送与官网线上更新需要另行配置与执行，本记录不声称已完成这些操作。

## 最终整体检查

2026-10-01 最终独立审查后，`npm run check` 的 65 项测试全部通过，投稿检查通过，真实目录预览导出 3 个合集；`npm run validate:publish` 通过，正式构建排除这 3 个待审合集。首次引入内容时，旧基线没有 `collections/` 可以按空基线校验；当前内容源缺目录仍报错。

同步回归覆盖真实三合集的临时网站 CLI 安装、索引与详情一致、素材逐字节一致、固定版本、校验和、路径与 ZIP 边界、预览隔离、并发锁和上一版回退。损坏更新保留原快照；清理更旧备份的权限失败不会把已经完成的切换误报为失败，返回 `cleanupPending`，保留可回退的上一版。该权限回归实际设置不可读目录，先复现 EACCES，再验证修复。

远端 Release 获取使用可控 HTTP 响应验证协议与校验逻辑；没有实际创建 GitHub Release、设置仓库规则、通知官网或部署 Cloudflare。官网当前 Vite 本地数据导出需要在正式接入时切换，完整网站构建与线上数据版本的验收尚未执行，详见[部署文档](deployment.zh.md)。

## 双语文档更新

项目指南与模板默认文件改为英文，中文另存对应 `.zh.md` 文件。两份项目介绍的自动目录分别使用各自语言的简介。翻译缺失或不完整时，使用网址名称和本页语言的待翻译提示，不混入另一种语言的正文。新建草稿默认使用英文，指定 `--lang zh` 可创建中文草稿。

本次更新保留三个合集的网站数据。回归检查覆盖双语目录、缺译和部分翻译、新建默认语言，以及第二份项目介绍替换失败时两份文档和旧快照的恢复。仓库规则仍集中在一份简短的 `AGENTS.md` 中，`CLAUDE.md` 引用它。
