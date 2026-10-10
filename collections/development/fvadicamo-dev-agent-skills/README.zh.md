# Dev Agent 开发技能

在 Claude Code 中规范 Git、GitHub、隐私检查与技能编写。

## 合集介绍

作者通过多个插件提供提交、拉取请求、决策记录、公开仓库隐私保护和技能创建流程。本合集保留这些插件的完整技能目录；另一个 guardrails 插件提供配套钩子。

## 适用场景

- 准备规范提交与拉取请求
- 处理评审反馈并检查合并条件
- 记录决策并检查公开仓库隐私

## 使用建议

按上游方式安装 Claude Code 插件以保留钩子。GitHub 流程需要 GitHub CLI；隐私检查需要为当前仓库配置本地禁止公开的信息清单。

## 技能

- [plugins/decision-records/skills](https://github.com/fvadicamo/dev-agent-skills/tree/8e710c57b4aa34fec63752ccf04a47adb4a8be65/plugins/decision-records/skills)
- [plugins/github-workflow/skills](https://github.com/fvadicamo/dev-agent-skills/tree/8e710c57b4aa34fec63752ccf04a47adb4a8be65/plugins/github-workflow/skills)
- [plugins/privacy-guard/skills](https://github.com/fvadicamo/dev-agent-skills/tree/8e710c57b4aa34fec63752ccf04a47adb4a8be65/plugins/privacy-guard/skills)
- [plugins/skill-authoring/skills](https://github.com/fvadicamo/dev-agent-skills/tree/8e710c57b4aa34fec63752ccf04a47adb4a8be65/plugins/skill-authoring/skills)

## 来源

https://github.com/fvadicamo/dev-agent-skills
