# 自动生成的目录数据

[英文版](format.md)

贡献者提交合集 README 和可选封面。CI 自动生成官网 JSON；贡献者和维护者都不需要为新合集创建 JSON 文件。投稿格式见[贡献指南](../../CONTRIBUTING.zh.md)。

## 输入与生成

英文使用 `README.md`，中文使用 `README.zh.md`。每份文件保持一种语言，已有翻译同步更新。标题、短简介、合集介绍、适用场景、使用建议、来源和可选封面从这些文件读取。分类由目录确定。

CI 解析 README 中的 GitHub 技能链接：

- `SKILL.md` 文件链接只包含该技能。
- 目录或仓库链接递归包含其中全部 `SKILL.md` 文件。
- 每个来源固定到一个提交。技能简介原样采用上游内容；安装目录和许可依据从同一提交读取。

生成的 JSON 放在 `dist/`，不提交到源码仓库。详细数据格式见[官网数据契约](../../scripts/lib/site-contract.mjs)。目录链接表达包含范围，不定义网页分组或配套包。

## 稳定数据

三份迁移的 `.catalog/*.json` 保留已有身份、版本、分组和配套包安装关系。它们是兼容输入，不是新投稿的模板。

后续生成以上一次正式快照为基线。同一份 README 输入复用已记录的来源提交。输入变化时重新解析，保留稳定身份和版本历史，避免无关 PR 悄悄更新上游技能。可信 CI 通过 `CATALOG_USE_RELEASE_BASELINE=1` 读取上一次 Release 快照；本地生成使用已有缓存或显式基线。

## 审核与核验

PR 的 CI 检查格式，解析上游数据并生成预览。新记录在预览中保持待审状态。检查通过不代表正式批准。

可信的 `main` 发布工作流使用 `--reviewed-main`，通过 GitHub 核对真实已合并的 PR，再将其生成内容标记为审核通过。迁移记录保留已有审批。本地预览不授予审批。

读取源文件不等于实测安装或使用。未知许可保留 `NOASSERTION`；资源检查保持 `needs-review`；安装和流程结果保持 `not-tested`，直到有真实测试依据。保留图片的真实署名和权利依据。安装或流程实测失败时阻断正式发布。

## 命令

`npm run validate` 离线检查 README 格式。`npm run validate -- --resolve-upstream` 还会解析链接指向的上游来源。`npm run build`、`npm run build:preview` 和 `npm run dev:site` 默认解析上游数据。因此，`npm run check` 生成预览时需要联网。

封面可选。本地封面进入快照；HTTPS 封面保留直链，不下载。官网预览、发布与回退见[部署说明](deployment.zh.md)。
