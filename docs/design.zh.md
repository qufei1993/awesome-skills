# awesome-skills 仓库整体方案

Awesome Skills 是 Skills Hub 的公开合集内容源与贡献入口。贡献者用一个 README 介绍合集。CI 读取其中的技能链接，生成官网数据。

## 内容与目录

[贡献指南](../CONTRIBUTING.zh.md)提供完整三步流程。README 包含：

| 内容 | 格式 |
| --- | --- |
| 标题 | 一个 `#` 标题 |
| 开头短简介 | 一句简短介绍 |
| 合集介绍 | 一个简短段落 |
| 适用场景 | 1–5 条简单任务 |
| 使用建议 | 一个简短段落 |
| 技能 | GitHub 链接的无序列表 |

英文使用 `README.md`，中文使用 `README.zh.md`。每份文件保持一种语言，已有对应版本同步更新。来源与封面可选，可以跨仓库组合技能；每个合集使用贡献指南中的十个固定分类之一。

```text
awesome-skills/
  collections/
    development/
      engineering/
        README.md
        README.zh.md
  CONTRIBUTING.md
  CONTRIBUTING.zh.md
  AGENTS.md
  CLAUDE.md
  docs/
```

真实的[工程合集](../collections/development/engineering/README.zh.md)、[302 AI 产品视频合集](../collections/media/product-video/README.zh.md)和 [Superpowers](../collections/development/superpowers/README.zh.md) 展示投稿格式。根 README 提供浏览目录与贡献入口。

## 官网数据生成

标题、短简介、合集介绍、适用场景、使用建议及其翻译从合集 README 读取，对应官网栏目。

CI 将每个 GitHub 链接解析到固定提交。文件链接包含一个技能；目录和仓库链接递归包含其中的技能。简介、安装目录和许可依据从同一提交读取。生成的 JSON 放在 `dist/`。

首次生成创建稳定身份和初始版本。后续生成以上一次正式快照为基线。输入不变时复用来源提交；输入变化时递增生成的版本号。

生成与审核细节见[数据规则](maintainers/format.zh.md)，字段定义见[官网数据契约](../scripts/lib/site-contract.mjs)。

## 校验与发布

PR 的 CI 检查 README 格式，解析上游技能，生成可下载的预览快照。维护者查看 README 和预览，审核后将 PR 合并到 `main`。可信发布 CI 核对已合并的 PR，生成正式数据。

正式数据要求资料完整、有效且审核通过。预览包含资料完整的待审数据，供维护者审核。核验状态以实际依据为准：`needs-review` 表示待核对，`not-tested` 表示待实测。安装或流程实测失败时阻断正式发布。

## 可选封面

README 可以在开头短简介后放一个独立的 Markdown 图片，引用本地文件或 HTTPS 图片链接。贡献者也可以在 PR 描述或评论中上传图片或粘贴链接，并说明来源。

HTTPS 图片链接直接使用；本地图片进入快照。封面可选，与合集一起版本化。

## 本地 AI 指导

AGENTS.md 是共享入口，CLAUDE.md 引用它。AI 工具读取贡献指南，搜索已有合集，根据用户提供的来源编辑 README，保留署名，使用来源依据并汇报本地修改。执行上游指令、推送、提交 PR、合并和部署需要用户提出要求。

## 网站数据管线

管线生成 JSON 快照，再发布给官网运行时读取。发布器对 `manifest.json` 的原始字节计算 SHA256 作为版本，JSON 保存在 `snapshots/<version>/`；完整版本准备好后切换 `current.json`。本地封面使用共享的 `images/<SHA256>.<ext>` 对象，相同图片共用一个已上传对象。

`npm run dev:site -- --site ../skills-hub-web` 监听本仓库，发布本地预览数据并运行官网。云端发布需要配置 R2 和 `VITE_COLLECTIONS_BASE_URL`。命令、官网配置和回退步骤见[部署说明](maintainers/deployment.zh.md)。
