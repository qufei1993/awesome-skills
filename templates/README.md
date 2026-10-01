# 投稿模板

使用 `npm run new:collection -- SLUG --lang zh` 或 `--lang en` 创建合集。该命令只在首次创建时生成稳定 UUID；后续直接编辑同一个文件。命令不会替你核实来源、许可或生成测试结论。

[collection.md](collection.md) 展示需要填写的结构，故意不填虚构的仓库、提交版本、作者或许可。它是待编辑模板，**不能原样通过投稿校验**。`id` 使用新建命令生成的 UUID；移除说明性注释，并按 [格式规则](../docs/format.md) 补全真实信息。

完整真实示例位于：

- [Taste](../collections/taste/README.md)：同一作者仓库，13 个展示条目、13 个安装项。
- [Engineering](../collections/engineering/README.md)：作者仓库多个分组，31 个展示条目、31 个安装项。
- [Product Video](../collections/product-video/README.md)：公开文章推荐、跨仓库搭配，3 个展示条目展开为 14 个安装项。

这三份示例通过投稿结构规则；审核为 `pending`，安装和工作流为 `not-tested`。不要把示例的来源、核验日期或许可复制到不相关投稿。原创跨仓库合集使用 `sourceKind: editorial-selection`，并在 `provenance.selectionReason` 中说明策划理由。

供稿者负责标题、简介、场景、使用建议、Skill 用途及公开出处。维护者在正式收录前补齐或核对稳定身份、时间、固定 commit、来源证据、资源范围与审核记录。草稿允许缺少部分维护字段，但应逐项列出待补充内容；正式发布条件更严格。封面默认使用概念封面。
