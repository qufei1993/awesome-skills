# Anatomy

用 SVG 构建细节丰富、可交互的等距机械与仪器模型，解释技术概念。

## Overview

wheresryan22 开发的 Anatomy 将概念映射为可辨认的实体机构，通过带明暗层次的立体零件、可操作控件和实时读数解释其工作原理，运动与读数由同一模型驱动。支持输出独立 HTML、SVG 或 React/Next.js 组件，可选配 WebGL 效果和实验性 3D 模式。上游项目采用 MIT 许可证。

## Scenarios

- 用可交互的实体类比解释算法与系统
- 为技术文档和文章制作说明插图
- 为产品与落地页构建精细的技术图形
- 用剖面和爆炸视图展示机械结构

## Usage

为所用智能体安装上游 Skill 后，在 Claude Code 中通过 `/anatomy`、在 Codex 中通过 `$anatomy` 描述概念与交互需求，例如制作交互式令牌桶限流器。运行需要 Node.js 20.10+，验证需要 Chrome 或 Chromium。可先从 SVG 开始，火焰、水等效果可选用 WebGL，3D 模式仍处于实验阶段。

## Skills

- [Anatomy](https://github.com/wheresryan22/anatomy/blob/e9488296a44211c42701ff71705b7901470ec78f/SKILL.md)

## Source

https://github.com/wheresryan22/anatomy
