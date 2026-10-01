# Awesome Skills 实施计划

**目标：** 实现已批准的 Markdown 合集目录、PR 校验、AI 贡献指导、快照导出与网站同步；以 Taste、Engineering 和产品宣传视频验证流程。
**方案：** [design.zh.md](design.zh.md)
**架构：** Node.js 22 ESM、YAML 元数据与 Markdown AST；不执行上游 Skill。Markdown 是唯一可编辑的内容源，生成 JSON 遵循 Skills Hub 现有数据契约。
**执行：** 根代理整合独立的解析器、编译器和文档任务，并完成测试与独立审查。

## 决定与接口

- 临时实施目录：`/tmp/awesome-skills-implementation`；原仓库提交：`b58a533540f6607a3c2755457ee1639b9c4c1ad3`；目标分支：`codex/markdown-collections`。
- 三份原始夹具在 `tests/fixtures/site` 中作为不可修改的预期数据。实际 Markdown 合集保留身份、来源与安装数据。审核状态改为 `pending`，因为此前批准仅覆盖展示迁移，并非新的来源核验。保留原审核说明和全部核验状态，不宣称已经实测。
- 根目录的浏览列表位于 HTML 标记之间，由生成器维护。待审记录可在 GitHub 与预览中浏览。正式导出仅包括 `active` 且 `approved`、来源/文件/资源均已核实、没有失败实测并且封面可用的记录。不得伪造批准。
- YAML 禁止重复键、别名与合并键，在各字段所属边界拒绝未知字段。Markdown AST 选择真实标题与代码节点，不把围栏中的标题样式文本当作标题。
- 主文件为 `collections/<slug>/README.md`：元数据包含机器字段，H1 为标题，随后是一段简介；H2 为概览、适用场景、使用建议与 `Skills`，也支持相应英文标题。`Skills` 中每个 H3 是名称，正文是摘要，一个 YAML 围栏记录 `id`、`entry`、安装模式与安装项、资源核对状态与说明，以及可选的 `role`、`authors`、`originalDescription`。
- 保留元数据中的现有 `localizations.en`，确保迁移无损。如果可行，支持独立、可选的 `README.en.md` / `README.zh.md` 展示译文；接受英文主文，不编造翻译。
- 封面 `cover.file` 使用相对本合集目录的路径；编译器生成托管 URL。正文可以引用相对图片路径。CI 不下载附件 URL。
- 导入的 `site-contract.mjs` 是官网现有的纯校验与索引契约。导出 `validateCollection` 和 `indexItem` 供复用，保留契约行为；编译器增加更严格的发布检查与安全封面处理。

## 任务

1. 解析器：`scripts/lib/markdown.mjs` 导出 `parseCollectionMarkdown(source,{filename})`、`serializeCollectionMarkdown(document,{language,coverFile,curator})`，以及实现时的 `parseTranslationMarkdown`。解析器返回 `{document,language,coverFile,curator}`，错误包含文件名与字段。保留缺失的维护字段，不生成默认值、身份、时间、commit 或核验结论；编译器为不完整草稿使用独立的投稿校验副本，这些草稿不能发布。测试验证三份夹具往返无损，并覆盖非法结构。
2. 编译器：`scripts/lib/catalog.mjs` 导出 `loadCatalog({rootDir,mode='submission',baseDir})`、`validateCatalog(options)` 和 `buildCatalog({rootDir,outputDir,preview=false,baseDir,sourceRevision})`，返回索引与记录。`scripts/catalog.mjs` CLI 处理 `validate [--publish --base-dir]`、`build [--preview --output]`、`new`。把解析器结果转换为现有官网 JSON。检查身份/来源标识冲突、路径、封面、稳定更新与版本。完整暂存输出快照后再替换，manifest 保存校验和。生成 README 标记内目录。测试冲突、发布门槛、去重统计及构建失败时保留旧版本。
3. 文档与 CI：README、CONTRIBUTING、AGENTS、CLAUDE、`docs/format.md`、`docs/deployment.md`、模板、PR 与 Issue 模板、工作流。根 AGENTS 是唯一共享入口，CLAUDE 引用它。PR 结构检查使用只读 token，不提供 secrets；更新针对基线校验。发布仅在已审核变更推入 main 后生成不可变快照产物，并支持可选的认证官网通知。CI 不自动运行投稿 Skills。
4. 根代理集成：将三份真实夹具导入为可读 Markdown，复制其引用封面，除新的 `pending` 审核外不丢元数据。增加安全网站同步 CLI，获取公开仓库固定提交对应的数据或读取本地快照，验证 manifest 并暂存后替换。增加安装去重一致性、语言、预览与正式发布的端到端测试。完成全项目独立审查后，应用到用户目录，保留 Git 和并发修改文件。
5. 验证 `npm ci` / `npm run check` / `npm run build` / 拒绝非法发布的测试，以及真实 13/31/3 个展示条目、13/31/14 个展开安装项；使用官网契约校验输出。明确记录部署前提，不宣称云端已配置，不在未收到指令时推送。
