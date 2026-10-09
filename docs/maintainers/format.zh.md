# 自动生成的目录数据

[英文版](format.md)

贡献者提交合集 README 和可选封面。CI 自动生成官网 JSON。投稿格式见[贡献指南](../../CONTRIBUTING.zh.md)。

## 输入与生成

英文使用 `README.md`，中文使用 `README.zh.md`。每份文件保持一种语言，已有翻译同步更新。标题、短简介、合集介绍、适用场景、使用建议、来源和可选封面从这些文件读取。分类由目录确定。合集输入包含 README 和本地封面。

CI 解析 README 中的 GitHub 技能链接：

- `SKILL.md` 文件链接只包含该技能。
- 目录或仓库链接递归包含其中全部 `SKILL.md` 文件。
- 每个来源固定到一个提交。技能简介原样采用上游内容；安装目录和许可依据从同一提交读取。

生成流程把上游仓库的浅克隆缓存放在 `dist/upstream-repositories/`。浅克隆只获取需要的提交历史。生成流程从固定提交读取完整目录树和技能文件，并校验 Git 哈希。后续生成复用这些缓存。

生成的 JSON 是构建产物，放在 `dist/`。目录链接确定合集包含哪些技能。详细数据格式见[官网数据契约](../../scripts/lib/site-contract.mjs)。

## 稳定数据

首次生成创建稳定身份和初始版本。后续生成以上一次正式快照为基线。合集输入不变时复用已记录的来源提交。输入变化时重新解析，保留稳定身份和版本历史。可信 CI 从 `CATALOG_DATA_BASE_URL` 指定的发布数据地址读取 `current.json` 和对应快照。本地生成使用已有缓存或显式基线。

## 审核与核验

PR 的 CI 检查格式，解析上游数据并生成预览。新记录在预览中保持待审状态。

可信的 `main` 发布工作流使用 `--reviewed-main`，通过 GitHub 核对真实已合并的 PR，再将其生成内容标记为审核通过。

核验状态以实际依据为准。未知许可使用 `NOASSERTION`；待核对的资源使用 `needs-review`；待实测的安装和流程使用 `not-tested`。图片署名和权利依据按实际来源记录。安装或流程实测失败时阻断正式发布。

## 命令

`npm run validate` 离线检查 README 格式。`npm run validate -- --resolve-upstream` 还会解析链接指向的上游来源。`npm run build`、`npm run build:preview` 和 `npm run dev:site` 默认解析上游数据。`npm run check` 生成预览时需要联网。

封面可选。本地封面进入快照；HTTPS 封面保留直链。官网预览与发布见[部署说明](deployment.zh.md)。
