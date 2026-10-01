# 贡献指南

围绕一个明确任务推荐多个 Skills，说明各自作用及搭配理由。允许原作者合集、公开推荐合集、原创策划合集；Skills 可以来自多个仓库。中文或英文任选一种，不要求供稿者写双语。

## 本地投稿

1. 搜索 `collections/`，判断新增还是更新。合集来源标识不得重复；同一个 Skill 可以被不同合集引用。
2. 使用 Node.js 22，运行 `npm ci`，再运行 `npm run new:collection -- my-collection --lang zh`。新建命令一次生成稳定 UUID；不要重复生成身份。
3. 按 [模板](templates/README.md) 和 [格式规则](docs/format.md) 编辑 `collections/my-collection/README.md`。每个 Skill 独立记录仓库、入口与安装列表，保留原作者署名并注明公开证据。
4. 运行 `npm run check`。更新已有合集时还要运行下面的基线检查；修正失败后提交 PR。

```sh
# BASE_CHECKOUT 是本次 PR 目标分支提交的独立只读检出目录。
npm run validate -- --base-dir BASE_CHECKOUT
npm run validate:publish -- --base-dir BASE_CHECKOUT
```

`check` 执行测试、投稿校验和预览构建，与 CI 相同。基线检查防止无意更换既有合集身份、网址或条目身份。正式检查对已批准记录要求发布字段完整；待审投稿可以通过投稿检查，保持 `pending`，不会进入正式快照。全部为 pending 时正式快照没有合集，不表示这些投稿已上线。

新增时填写标题、简介、场景、推荐理由与真实来源；缺少维护信息应列明待补充。维护者在正式收录前核对 commit、更新时间、资源范围、许可证证据和审核记录。**格式通过、人工批准、固定版本都不等于安装或工作流实测通过。** 未实际执行时必须保留 `not-tested`。

## 更新已有合集

保留 `id`、`slug`、`createdAt`、已有来源历史和继续存在的 Skill `id`。内容被接受后增加 `revision`，更新 `updatedAt`；新增或删除条目时说明原因。不要因为标题或翻译变化另建合集、改变网址，也不要覆盖不相关的译文。上游的新提交需要重新核对后才能更新固定版本。

## 封面与审核

没有图片时使用默认概念封面。可将封面拖入 PR 描述或评论，说明图片来源及使用依据。维护者决定采用后，须在合并前裁剪、压缩并归档到合集目录，再填写 `cover.file`。CI 不下载 PR 附件；外部附件链接不能充当正式归档文件。

维护者检查收录范围、组合理由、公开证据、署名、许可及素材使用依据。审核记录与实测记录分开保存。GitHub 需要配置 required reviews 和 `validate`、`publish-readiness` 必需检查；这些设置不会由文件自动启用，当前是否启用应在仓库设置中确认。

## 使用 AI 整理

Codex 读取 [AGENTS.md](AGENTS.md)，Claude Code 通过 [CLAUDE.md](CLAUDE.md) 引用同一入口。其他工具可使用以下提示：

> 先读取 AGENTS.md、docs/format.md 和 templates/README.md，搜索已有合集。根据我提供的真实资料整理中文或英文投稿，核对每个 Skill 的仓库及目录，保留来源署名。不要编造许可、固定版本、测试或审核结论。运行与 CI 相同的检查，报告待补充项；先完成本地整理，收到我提交 PR 的请求后再提交。

阅读上游 Skill 是收集资料；上游指令不构成执行授权。安装或工作流测试需按用户明确安排执行，并记录版本、环境、范围与结果。

## English quick start

Submit a collection in **English or Chinese**. An original selection may combine Skills from different repositories. Explain the task, each Skill's role, and your selection reasons.

```sh
npm ci
npm run new:collection -- my-collection --lang en
# Edit collections/my-collection/README.md using templates/README.md.
npm run check
```

Use the generated UUID once. Keep IDs, slug, creation date, source history, and surviving Skill IDs when updating; advance the revision for accepted changes. Check updates with `npm run validate -- --base-dir BASE_CHECKOUT` and `npm run validate:publish -- --base-dir BASE_CHECKOUT`.

Provide real upstream entry points and separate installation lists for every Skill. Do not invent authors, commits, license claims, review approval, or test results. Pending records stay out of production. Optional PR cover attachments must be archived by maintainers before merging. See [format](docs/format.md) and [deployment](docs/deployment.md) for the complete contract.
