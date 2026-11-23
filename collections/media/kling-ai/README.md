# Kling AI Skills

Plan prompts and storyboards, then generate images or video with the official Kling AI plugin for Claude Code.

## Overview

Each regional plugin bundles three Skills for request routing, image generation, and video generation. The plugin configures an OAuth MCP connection to the hosted Kling AI service.

## Scenarios

- Refine an image prompt for a product shot or poster.
- Plan a video storyboard and prepare prompts for its shots.
- Submit an approved image or video generation and check its status.

## Usage

Install the complete [Global plugin](https://github.com/klingai-tech/claude-plugin) for a Kling Global account or the [China plugin](https://github.com/klingai-tech/claude-plugin-cn) for a Kling China account. Their MCP endpoints are `https://kling.ai/mcp/plugin` and `https://klingai.com/mcp/plugin`, respectively. Connect via OAuth. Accounts, credits, and tasks are separate by region. Generation uses paid credits from the Personal workspace and requires user confirmation. See the official [Global](https://kling.ai/app/mcp/guide) and [China](https://klingai.com/app/mcp/guide) guides for CLI setup.

## Skills

- [Global plugin Skills](https://github.com/klingai-tech/claude-plugin/tree/53ff743cec8322f5930d86d4e1bf34fe485769e5/skills)
- [China plugin Skills](https://github.com/klingai-tech/claude-plugin-cn/tree/b6fab2b12d159301038a726716e3fc35e4e18ca7/skills)
