# 数据发布与官网预览

[英文版](deployment.md)

投稿提交 README 和可选封面。CI 自动解析其中的上游技能链接，生成官网 JSON。详见[数据规则](format.zh.md)。

## 从 PR 到官网

1. PR 的 CI 检查 README 格式，解析上游技能并生成预览快照。
2. 维护者查看 README 和预览，审核后将 PR 合并到 `main`。
3. 可信发布 CI 通过 `--reviewed-main` 核对已合并的 PR，生成正式快照，发布到配置的目标。
4. 官网运行时读取新的 `current.json`，加载更新后的合集数据。

快照是一份完整的合集数据与封面素材。PR 产物名为 `catalog-preview-<快照SHA>`，保留 30 天。每份在归档根目录包含 `catalog-preview.zip` 和 SHA256 校验文件。CI 验证快照文件，将 `sourceRevision` 与实际检出的提交核对；工作流摘要另列 PR 分支提交。

预览包含待审记录，供维护者审核。正式消费端使用正式快照，要求资料完整、有效且审核通过。安装或流程实测失败时阻断发布。来源、资源、权利和测试状态以实际依据为准；`needs-review` 与 `not-tested` 原样展示。

可信 CI 通过 `CATALOG_USE_RELEASE_BASELINE=1` 读取上一次正式 Release 快照。输入不变时保留来源提交、身份和版本历史。解析或发布失败时，保留上一份已发布数据。

## 本地预览

使用 Node.js 22 或更高版本，安装两个仓库的依赖。指定路径必须有官网项目。

```sh
npm ci
npm --prefix ../skills-hub-web ci
npm run dev:site -- --site ../skills-hub-web
```

此命令生成预览，提供数据服务并启动既有官网。默认官网端口为 8775，数据端口为 8776。它监听 README、本地封面和兼容资料。有效修改发布完整预览版本；修改失败时继续提供上一份数据。

临时修改一份开头短简介，在官网确认效果，再恢复这处修改并再次确认。

自动官网验证需要安装 Google Chrome，再运行 `npm run test:site -- --site ../skills-hub-web`。测试使用临时副本，检查列表、详情、更新、图片复用、发布失败和回滚。

## 本地生成与发布文件

```sh
npm run check
npm run build:preview -- --output dist/collections --source-revision FULL_COMMIT_SHA
npm run publish:data -- publish --from dist/collections --to dist/published --preview
```

将 `FULL_COMMIT_SHA` 替换为完整的 40 位来源提交。生成和预览命令需要联网解析上游数据。`npm run validate` 只离线检查 README 格式；增加 `--resolve-upstream` 后才解析来源。

生成已有审批的正式快照时，使用 `npm run build`，发布命令省略 `--preview`。本地生成的新合集保持待审。可信的已合并 PR 发布工作流使用 `--reviewed-main` 授予审批。

原始快照包含 `index.json`、合集详情、归档封面和 `manifest.json`。清单逐项记录文件路径、SHA256 和大小。发布后的目录如下：

```text
dist/published/
  current.json
  snapshots/<version>/
    index.json
    <collection-id>.json
    manifest.json
    release.json
  images/<SHA256>.<ext>
```

发布版本是清单原始字节的 SHA256；`sourceRevision` 是来源提交。`current.json` 选择快照，并把本地封面路径映射到共享图片对象。相同本地图片共用一个已上传对象。HTTPS 封面保留直链。发布先准备全部文件，再切换指针；失败保留原指针。

## 配置 R2 与官网

在 GitHub 仓库设置以下变量与密钥：

| 设置 | 存储位置 | 内容 |
| --- | --- | --- |
| `CATALOG_PUBLICATION_MODE` | 变量 | `r2` |
| `CATALOG_R2_ACCOUNT_ID` | 变量 | Cloudflare 账户 ID |
| `CATALOG_R2_BUCKET` | 变量 | 数据桶名称 |
| `CATALOG_R2_ACCESS_KEY_ID` | 密钥 | R2 访问密钥 ID |
| `CATALOG_R2_SECRET_ACCESS_KEY` | 密钥 | R2 私密密钥 |

通过公开端点提供桶内容，允许官网来源读取。将官网的 `VITE_COLLECTIONS_BASE_URL` 指向包含 `current.json` 的数据根地址。本地或测试环境使用 `VITE_COLLECTIONS_ALLOW_PREVIEW=true`。远端数据根地址留空时，使用既有本地快照路径。

设置 `CATALOG_PUBLICATION_MODE=r2` 并填写完整 R2 配置后，启用上传。发布模式留空时，CI 保留快照产物和 Release。R2 配置不完整时发布失败。工作流串行发布，在上传前和切换 `current.json` 前检查 `main` 最新提交。来源提交过旧时跳过切换。GitHub 提交检查与 R2 指针条件写入分别执行。

手动上传已验证的正式快照时，安全提供上述 R2 变量，再运行：

```sh
npm run publish:data -- publish --from dist/collections --r2
```

预览上传还需 `--preview --test-destination`，只能用于测试目标。核对真实公开端点和版本后，才能报告云端发布或官网更新。

## 回退与兼容同步

保留已发布快照和图片。运行时发布可以切换到已验证的版本：

```sh
npm run publish:data -- rollback --to dist/published --version VERSION_SHA256
```

仍支持直接复制快照：

```sh
npm run sync:site -- --from dist/collections --target ../skills-hub-web
npm run sync:site -- --repo OWNER/REPO --ref FULL_COMMIT_SHA --target ../skills-hub-web
npm run sync:site -- --rollback --target ../skills-hub-web
```

复制工具验证完整快照，整体替换 `public/data/collections`。上一版保存在 `.catalog-sync/previous`；官网仓库应忽略 `.catalog-sync/`。只有本地或测试复制才增加 `--preview`。整体恢复版本，确保索引、详情和图片一致。
