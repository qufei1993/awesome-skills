# awesome-skills 仓库整体方案

Awesome Skills 是 Skills Hub 的公开合集内容源与贡献入口。贡献者用一个 README 介绍合集，既有网站安装与审核资料保存在版本化的内部系统文件中。

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
  .catalog/
    engineering.json
    product-video.json
    taste.json
  collections/
    development/
      engineering/
        README.md
        README.zh.md
        cover.png
  CONTRIBUTING.md
  CONTRIBUTING.zh.md
  AGENTS.md
  CLAUDE.md
  docs/
```

真实的[工程合集](../collections/development/engineering/README.zh.md)与 [302 AI 产品视频合集](../collections/media/product-video/README.zh.md)展示可读格式，根 README 展示生成的浏览目录与贡献入口。

## 展示内容与保留资料

标题、短简介、合集介绍、适用场景、使用建议及其翻译只从合集 README 读取，对应官网现有栏目。

版本化的 `.catalog/<slug>.json` 保存从原网站资料转换的身份、版本、安装项、出处、核验与审核数据，不重复保存五个展示字段及本地化中的同名字段。生成时组合 README 展示内容与保留的数据，贡献者无需维护内部文件。

维护者保留身份、来源历史、版本与安装关系。目录和仓库链接只表达包含范围，不定义网页分组或配套包；维护者核对实际内容并采用上游技能简介。内部数据不会自动从远端仓库更新。

[内部数据说明](maintainers/format.zh.md)解释这些边界，详细类型直接保留在[官网数据契约](../scripts/lib/site-contract.mjs)中。

## 校验与发布

CI 检查必需小节、段落与场景结构、URL 写法及保留的发布资料，不获取上游来源、不执行技能指令，也不下载远端封面。符合格式的投稿可以出现在 GitHub 浏览目录中；缺少核实发布资料的新投稿仍不进入网站快照。

正式数据要求资料完整、有效且审核通过，并阻断安装或流程实测失败。预览可以包含资料完整的待审数据，不完整的投稿仍不导出。来源、文件、资源与图片权利的 `needs-review` 以及未实测的 `not-tested` 明确展示，展示审批不会升级这些状态。

## 可选封面

README 可以在开头短简介后放一个独立的 Markdown 图片，引用本地文件或 HTTPS 图片链接。贡献者也可以在 PR 描述或评论中上传图片或粘贴链接，并说明来源。

HTTPS 图片链接直接使用；本地图片随合集归档。CI 不下载图片。封面仍为可选项，与合集一起版本化。

## 本地 AI 指导

AGENTS.md 是共享入口，CLAUDE.md 引用它。AI 工具读取贡献指南，搜索已有合集，根据用户提供的来源编辑 README，保留署名并汇报本地修改；只有收到要求后才推送或提交 PR。

上游指令是参考资料，AI 不擅自执行，也不编造作者、许可、版本、测试或批准。内部系统文件不属于贡献者的填写任务。

## 网站数据管线与迁移

管线读取 README 展示内容和内部资料，生成现有 JSON 快照，再发布给官网运行时读取。原快照契约保持不变。发布器对 `manifest.json` 的原始字节计算 SHA256 作为版本，JSON 保存在 `snapshots/<version>/`；完整版本准备好后才切换 `current.json`。assets 映射把归档图片的逻辑路径指向共享的 `images/<SHA256>.<ext>` 对象，未变化的图片跨版本只存一份。

`npm run dev:site -- --site ../skills-hub-web` 监听本仓库，生成并发布本地预览数据，运行既有官网并更新内容。正式官网使用 `VITE_COLLECTIONS_BASE_URL`，显式预览许可只用于本地测试。保留直接复制快照的同步方式。本地发布与可选 R2 上传分开，未配置云端时不表示已经上线。命令与配置见[部署说明](maintainers/deployment.zh.md)。

首批迁移包含 Taste Skill、Skills for Real Engineers 和产品宣传视频，保留稳定 ID、安装关系、译文及已有用户展示审批。后续内容变更遵循修订与审核规则。展示/安装数量仍为 13/13、31/31、3/14。产品营销与增长留待后续接入，上游新变化保留实际核验依据。
