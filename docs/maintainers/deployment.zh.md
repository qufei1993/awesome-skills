# 数据发布与本地官网预览

[英文版](deployment.md)

贡献者只编辑一份可读的合集 README。维护者组合其中五个展示字段与保留的 `.catalog` 数据，生成完整快照，再发布给官网运行时读取。参见[内部数据说明](format.zh.md)。

## 发布条件

正式数据要求资料完整、有效且审核通过，并阻断安装或流程实测失败。已有展示审批与来源、文件、资源、图片权利和实测依据分别保留，`needs-review` 与 `not-tested` 原样展示。三份迁移官网合集保留已有用户审批，可以正式导出；展示/安装数量仍为 13/13、31/31、3/14。

待审记录不进入正式数据。显式预览可以包含资料完整的待审记录；仅有 README、资料不完整的投稿不进入任何快照。检查只校验结构和已记录数据，不获取上游技能、不执行技能，也不下载远端封面。

## 本地生成与发布

```sh
npm ci
npm run check
npm run validate:publish
npm run build -- --output dist/collections --source-revision FULL_COMMIT_SHA
npm run publish:data -- publish --from dist/collections --to dist/published
```

`FULL_COMMIT_SHA` 是完整的 40 位来源提交。原始快照格式保持不变，包含 `index.json`、合集详情、归档素材及 `manifest.json`。清单逐项记录路径、SHA256 与大小，不包含清单自身。

发布器先验证快照，再写入分发目录。发布版本取清单原始字节的 SHA256；`sourceRevision` 仍表示来源提交，两者用途不同。

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

`current.json` 指向 `snapshots/<version>/`，其中的 `assets` 映射把 `assets/<collection-id>/cover.png` 等归档逻辑路径对应到共享图片对象。JSON 字节保持不变，原详情中的封面 URL 继续使用逻辑路径，由官网根据映射解析。只有归档图片进入此映射；HTTPS 封面保留直链，不下载或上传。未变化的归档图片跨版本只上传一次。完整文件准备好后才切换 `current.json`，发布失败保留上一指针。

手动预览时用 `npm run build:preview` 生成，并在发布命令中增加 `--preview`。正式消费端拒绝预览数据，本地测试需显式开启许可。

## 用既有官网联调

先安装两个仓库的依赖。指定路径必须有官网项目。

```sh
npm ci
npm --prefix ../skills-hub-web ci
npm run dev:site -- --site ../skills-hub-web
```

此命令生成并发布预览，提供本地数据服务，启动既有官网。默认官网端口为 8775，数据端口为 8776。它监听合集 README、归档封面和内部资料，变化后发布完整版本并更新运行中的官网。更新失败时继续提供上一份有效数据，官网源码仍使用正常的 Vite HMR。

核对连接时，可以临时修改一份合集的开头短简介，在浏览器确认新简介与发布版本，再恢复文件并确认原文返回。保留既有无关改动；此步骤不需要提交或上传。

自动验证需要先安装 Google Chrome，再执行 `npm run test:site -- --site ../skills-hub-web`。Playwright 已列入开发依赖。测试使用临时副本，检查列表、详情、自动更新、图片复用、发布失败和回滚，不改动真实合集。

正式官网通过 `VITE_COLLECTIONS_BASE_URL` 指向包含 `current.json` 的数据根地址。`VITE_COLLECTIONS_ALLOW_PREVIEW=true` 只在本地或测试环境允许预览。没有远端数据根地址时，仍可使用既有本地快照路径。

## 可选 R2 发布

```sh
npm run publish:data -- publish --from dist/collections --r2
```

由部署配置提供以下运行时环境变量：

| 变量 | 内容 |
| --- | --- |
| `CATALOG_R2_ACCOUNT_ID` | Cloudflare 账户 ID |
| `CATALOG_R2_BUCKET` | 数据桶名称 |
| `CATALOG_R2_ACCESS_KEY_ID` | 从安全凭据存储提供的 R2 访问密钥 ID |
| `CATALOG_R2_SECRET_ACCESS_KEY` | 从安全凭据存储提供的 R2 私密密钥 |

R2 使用相同的快照与共享图片目录。通过公开数据端点提供桶内容，把官网数据根地址设为该端点，并允许官网来源读取文件。上传预览还需同时增加 `--preview --test-destination`，只用于测试目标；正式工作流不开启预览。

同时发布或回滚时，指针采用条件更新。如果另一操作先切换指针，本次操作失败，并保留成功发布的版本。

CI 配置仓库变量 `CATALOG_PUBLICATION_MODE=r2`、账户和桶变量，以及上述两个访问密钥 secrets。未启用 mode 时，工作流报告数据上传未启用；启用后缺少配置则失败。工作流保留固定提交的原始快照产物和 Release 兼容方式，串行发布，在上传前检查 main 最新提交，并在所有不可变文件准备好后、条件更新 `current.json` 前再次读取。如果来源提交在上传期间变旧，工作流跳过指针更新并在摘要中说明，已上传的不可变对象仍可安全复用；最终检查失败也保留原指针。最终 GitHub 检查与 R2 条件写入缩小竞争窗口，但不构成跨服务的原子事务。本地发布和预览不读取 GitHub。官网运行时读取数据，无需发送重建通知。

本地产物和检查只能证明本地成功。桶与公开端点、GitHub 必需检查、凭据和官网配置属于部署设置；实际端点与版本验证后，才能报告云端发布或线上更新。

## 兼容同步与回退

保留直接复制快照的同步方式：

```sh
npm run sync:site -- --from dist/collections --target ../skills-hub-web
npm run sync:site -- --repo OWNER/REPO --ref FULL_COMMIT_SHA --target ../skills-hub-web
npm run sync:site -- --rollback --target ../skills-hub-web
```

复制工具验证完整快照，整体替换 `public/data/collections`，上一版保存在 `.catalog-sync/previous`。官网忽略规则应包含 `.catalog-sync/`。`--preview` 仅用于显式本地或测试预览。运行时发布则可以切换到保留且验证过的版本：

```sh
npm run publish:data -- rollback --to dist/published --version VERSION_SHA256
```

保留已发布快照与图片供回退使用。整体恢复指针或快照，索引、详情与图片来自同一版本。推送、提交 PR 或云端部署按用户要求执行。
