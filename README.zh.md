# Awesome Skills

为 Skills Hub 整理面向具体任务的技能合集。技能保留在各自的上游仓库中；本仓库记录组合用途、公开出处、安装清单和核验状态。

[英文版](README.md) · [贡献指南](CONTRIBUTING.zh.md) · [格式说明](docs/format.zh.md) · [部署说明](docs/deployment.zh.md)

## 浏览合集

目录由合集文档自动生成，并采用本页的语言。待审合集可以供社区阅读和讨论；进入目录不代表已批准收录或安装成功。尚无中文介绍的合集先显示网址名称，等待补充翻译。

<!-- catalog:start -->
- [Skills for Real Engineers](collections/engineering/README.md) — 从需求澄清到实现与验证，把工程经验带进 Agent 协作。（待审核）
- [产品宣传视频](collections/product-video/README.md) — 先明确需求，再制作画面，用 Skills 配合完成产品宣传视频。（待审核）
- [Taste Skill · 前端设计](collections/taste/README.md) — 从排版、风格到动效，让 AI 生成的界面更有设计感。（待审核）
<!-- catalog:end -->

## 参与贡献

允许中文或英文投稿，支持原作者合集、有公开出处的推荐合集，以及跨仓库的原创策划合集。请说明要解决的任务、每个技能的作用和搭配理由。

使用 Node.js 22，新建中文草稿：

```sh
npm ci
npm run new:collection -- my-collection --lang zh
```

新建命令默认使用英文；中文投稿需要指定 `--lang zh`。按照[模板说明](templates/README.zh.md)补全真实来源，再运行 `npm run check`。

每个技能单独记录入口与安装清单，封面可选。人工维护 Markdown；网站数据和浏览目录由工具生成。

## 文档约定

项目说明和模板默认使用英文，中文版本使用 `.zh.md` 后缀。修改时同步更新两个版本，每份文档只使用一种语言。

自动化工具共用一份 [AGENTS.md](AGENTS.md) 规则；[CLAUDE.md](CLAUDE.md) 引用同一入口。

## 当前发布状态

首批前端设计、工程实践和产品视频合集保留原有身份及安装记录，审核仍为待审，安装与工作流仍为 `not-tested`。13／31／14 表示展开后的安装项数量，不是测试成功次数。

正式快照只包含符合条件且审核通过的有效合集。预览快照可以包含完整的待审记录，仅能通过显式的本地预览模式同步。官网接入与仓库审核门槛仍需维护者配置，详见[验证记录](docs/verification.zh.md)。
