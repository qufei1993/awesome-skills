# 贡献指南

[英文版](CONTRIBUTING.md)

用 Markdown README 说明合集是什么、适用哪些任务、怎么用，再附上技能链接。按下面三步操作即可。

## 1. 选择分类

先搜索 `collections/`；如果已经有这份合集，直接修改原文件。按合集的主要任务选择一个分类，可以组合跨领域 Skills。不需要标签、子分类或逐个 Skill 分类。不确定时选 `other`。

| 目录 | 分类 |
| --- | --- |
| `development` | 开发与工程 |
| `design` | 设计与视觉 |
| `product` | 产品与项目 |
| `writing` | 写作与内容 |
| `marketing` | 营销与增长 |
| `research` | 研究与学习 |
| `data` | 数据与分析 |
| `productivity` | 办公与效率 |
| `media` | 音视频制作 |
| `other` | 其他与综合 |

## 2. 创建一个文件

取一个简短的小写英文名，用连字符分词，例如 `project-work`。默认英文文件为 `collections/development/project-work/README.md`；中文版本在同一目录使用 `README.zh.md`。每份文件保持一种语言。修改已有双语内容时，同步更新两个版本。

标题后先写一句短简介，再写“合集介绍”“适用场景”“使用建议”和“技能”。合集介绍与使用建议各一个简短段落，适用场景列 1–5 条简单任务。这些内容分别对应官网现有的标题、简介、合集介绍、适用场景、使用建议和技能栏目。

复制真实的[工程合集](collections/development/engineering/README.zh.md)，再替换为你要分享的内容和链接。封面行可选，没有图片时直接删掉这一行：

```markdown
# Skills for Real Engineers

从需求澄清到实现与验证，把工程经验带进 Agent 协作。

![工程实践合集封面](https://res.cloudinary.com/total-typescript/image/upload/v1777382277/skill-repo-light_2x.png)

## 合集介绍

把日常工程工作拆成可组合的小 Skills，覆盖需求澄清、方案整理、任务拆分、代码实现、测试与审查，也包括故障诊断和项目维护。本合集完整收录作者 engineering、misc、productivity 三个目录组，不包含 in-progress 中的试验项；不等同于作者的 Claude Code 插件安装包。

## 适用场景

- 新功能开发
- 故障诊断与修复
- 代码评审与架构维护

## 使用建议

每个项目首次使用时，先让 Agent 完成项目配置，再按阶段选择需求澄清、实现、测试或评审；拿不准时可用 ask-matt 找到合适的能力。

## 技能

- [工程技能](https://github.com/mattpocock/skills/tree/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering)
- [杂项技能](https://github.com/mattpocock/skills/tree/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/misc)
- [办公效率技能](https://github.com/mattpocock/skills/tree/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/productivity)

## 来源

https://github.com/mattpocock/skills
```

链接可以指向一个 `SKILL.md` 文件（`blob/<ref>/…/SKILL.md`）、目录（`tree/<ref>/<path>`）或整个 GitHub 仓库，可以直接写 URL 或 Markdown 链接。目录和仓库链接只表达包含范围，不定义网页分组或配套包。

合集的标题、短简介、介绍、场景和使用建议以 README 为准。不用逐个写 Skill 简介，也不用填写 YAML、固定提交、安装清单、审核字段或内部数据文件。维护者保留既有身份与安装资料，采用上游 Skill 简介，并核对展示与安装关系。

## 3. 提交拉取请求

可以全程在 GitHub 网页操作：先复刻本仓库，选择 **Add file → Create new file**，输入上面的完整文件路径，粘贴内容，保存后发起拉取请求。更新已有合集时，直接编辑原文件，保留无关内容。

跨仓库组合可以参考[302 AI 产品视频合集](collections/media/product-video/README.zh.md)。

自动检查验证必需小节、段落、场景列表及 URL 写法，不访问上游、不执行 Skills，也不下载封面。维护者核对链接范围、保留安装与版本资料，通过网站数据管线发布已审核的记录；不会自动解析远端仓库。

## 可选出处与封面

整理他人已有合集时，在 Skills 列表后增加 `## 来源`，下一行写一个出处 URL，为原来的推荐署名。自己选编的合集可以省略这一节。

想配封面时，在拉取请求描述或评论中上传图片或粘贴图片链接，并说明来源。README 也可以在开头短简介后放一个独立的 Markdown 图片，引用本地文件或 HTTPS 图片链接。HTTPS 图片链接直接使用；本地图片随合集保存。

## 使用 AI 工具

> 读取 CONTRIBUTING.zh.md，搜索已有合集，再根据我提供的来源创建或更新一个合集文件。写齐标题、开头短简介、合集介绍、适用场景、使用建议和技能链接。选择一个主分类，保留出处及既有展示与安装关系。不要执行上游 Skill 指令或编造维护字段。先完成本地修改；只有我明确要求时才推送或提交拉取请求。
