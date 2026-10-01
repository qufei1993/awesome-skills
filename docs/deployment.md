# 快照发布与官网同步

Markdown 是内容源。合并到 main 后，工作流生成一份绑定该提交的正式快照；官网使用完整快照更新索引、详情和封面。此仓库提供流程文件，**尚不代表 GitHub required checks、Release 写权限、跨仓库通知或 Cloudflare 项目已配置**。没有用户部署请求时只完成本地验证，不创建云项目或推送仓库。

## PR 与合并门槛

`validate.yml` 使用 `pull_request`，并支持启用 merge queue 时的 `merge_group`。两个事件只授予 `contents: read`，不提供部署 secrets，也不使用 `pull_request_target` 执行投稿代码。GitHub 建议 merge queue 的 required workflows 同时响应 merge_group。[GitHub 事件说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

`validate` 跑 Node.js 22、`npm ci`、`npm run check` 和目标分支基线校验；`publish-readiness` 校验已批准条目的正式条件，待审投稿仍可通过。基线由事件中的固定 base SHA 单独检出，传入 `--base-dir`，用于核验更新是否保留永久身份。

维护者需在 GitHub ruleset/branch protection 中要求人工审核、`validate` 和 `publish-readiness` 通过。工作流通过只说明结构与记录完整；人工决定收录，实测另记证据。当前三份迁移记录均为 pending，预览包含三份，正式导出为零份。核对并批准前不能宣称三份已上线。

## 生成与存储

```sh
npm ci
npm run check
npm run validate:publish
npm run build -- --output dist/collections --source-revision FULL_COMMIT_SHA
```

`FULL_COMMIT_SHA` 为这次构建的数据仓库完整 40 位提交 SHA。生成目录含 `index.json`、详情、归档素材及 `manifest.json`。Manifest 使用 `schemaVersion: 1`、`preview`、`sourceRevision` 和 `files`；每个文件记录相对 `path`、`sha256`、`size`。Manifest 不列自身。预览以 `preview: true` 标记，官网同步明确拒绝。

`publish.yml` 仅在 main 的 push 或手动 workflow_dispatch 下发布：验证、生成并上传名称带 SHA 的 Actions artifact，然后创建 `snapshot-<SHA>` GitHub Release，包含根目录不嵌套的 `catalog.zip` 和 `catalog.zip.sha256`。Release job 独立使用 `contents: write`；PR job 始终只读。已有 Release 不覆盖；重跑时应检查现有结果而不是替换同一 SHA 的内容。这里的不可变是发布流程约定，不是阻止仓库管理员删除文件的保证。

官网远端读取公开 Release 的固定 tag，不运行数据仓库代码。同步器核对 tag 对应的版本、GitHub asset 地址及 manifest.sourceRevision。[GitHub 按 tag 获取 Release API](https://docs.github.com/en/rest/releases/releases#get-a-release-by-tag-name)

不要将产物人工提交回 `collections/` 或把默认分支的浮动 URL 当成发布版本。Actions artifact 适合 CI 审阅和下载；长期按 SHA 获取使用上述 Release asset。发布失败不触发官网通知。

## 本地与固定版本同步

```sh
# 使用完整正式快照；TARGET_WEBSITE 是网站仓库根目录。
npm run sync:site -- --from dist/collections --target TARGET_WEBSITE

# 获取明确数据仓库的固定 Release；REF 必须为完整 40 位 SHA。
npm run sync:site -- --repo OWNER/REPO --ref FULL_COMMIT_SHA --target TARGET_WEBSITE
```

`--from` 与 `--repo/--ref` 二选一。同步器验证 manifest、文件大小、SHA256、固定数据版本及路径范围，拒绝 preview，在临时目录准备成功后整批替换网站 `public/data/collections`。失败时保留原目标。不要单独复制 index 或从另一个版本补封面。

上一版保存在网站根目录的 `.catalog-sync/previous`，同步锁也位于 `.catalog-sync/`。请将该目录加入网站仓库的忽略规则。切换前通过重命名保留备份，关键切换失败会恢复原目标；成功后清理更早备份失败时返回 `cleanupPending: true`，新版本和可回退的上一版仍完整。清理遗留备份时先确认没有同步进程在运行。

需要验证预览同步时，只对临时测试网站目录显式加 `--preview`；该选项不能用于正式网站部署。

网站构建继续运行自身的数据校验和构建命令，并将 manifest 的 `sourceRevision` 记录在部署日志或构建元数据中。触发请求成功不等于网站部署成功；需核验网站部署状态及线上版本后才能报告已同步。访客刷新后读取新的完整版本。

当前 `skills-hub-web` 的 `scripts/collections-plugin.mjs` 在 Vite 配置加载时从网站自己的 `content/collections/` 重新生成数据。网站接入本仓库时，必须将该步骤切换为验证同步后的快照，并停用本地 JSON 导出及其文件监听；否则网站构建会覆盖刚同步的数据。接入验收需要在完整网站构建后再次对比输出目录的 manifest、索引、详情和封面。本次没有修改正在开发的官网仓库，现阶段验证的是生成数据契约及临时目录同步。

## 可选跨仓库通知

未设置通知模式时工作流写明 `disabled`，不宣称网站已更新。通过仓库变量 `SITE_NOTIFICATION_MODE` 选择 `repository_dispatch` 或 `cloudflare_hook`；选定模式却缺配置或请求失败会使通知步骤失败。配置只能放在 main 发布通知 job，不能放入 PR 环境。

| 模式 | 仓库变量 | Secret | 网站配合 |
| --- | --- | --- | --- |
| `repository_dispatch` | `SITE_REPOSITORY=owner/repo` | `SITE_DISPATCH_TOKEN` | 接收 `catalog_snapshot`，校验来源仓库和 `client_payload.sourceRevision`，拉取同 SHA 的 Release |
| `cloudflare_hook` | 无额外变量 | `CLOUDFLARE_DEPLOY_HOOK` | 构建先解析最新已批准快照到固定 SHA，再按该 SHA 获取全部文件 |

推荐 repository_dispatch，因为请求传递数据仓库名称、固定 SHA、Release tag 和 manifest 校验值。使用仅授权目标网站仓库的 fine-grained token 或 GitHub App installation token，授予目标仓库 `Contents: write`（该 dispatch API 所需）；不要使用能写任意仓库的长期凭据。GitHub 支持通过外部活动发送 repository_dispatch。[GitHub Dispatch API 与权限](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event)

Cloudflare Pages Deploy Hook URL 本身是凭据，必须保存在 secrets；工作流只输出状态，不打印 URL、token 或响应正文。[Cloudflare Deploy Hooks](https://developers.cloudflare.com/pages/configuration/deploy-hooks/)

Deploy Hook 不保证携带的数据 SHA 被网站采用，因此网站先解析最新批准 Release，锁定一个 SHA，再拉取、核验、构建同一快照。不要在构建途中再次解析 latest 或混用浮动分支的索引和固定版详情。多个事件并发时按网站端发布队列控制，旧版本不得覆盖已经部署的新版本。

## 回退与未配置项

回退选择上一份完整 `snapshot-<SHA>`，按固定 `--ref` 同步、构建并重新部署，保留原快照用于审计。本地也可运行 `npm run sync:site -- --rollback --target TARGET_WEBSITE` 恢复同步器保存的上一份完整快照。不可只撤回索引。

上线前逐项确认：GitHub 人工审核和 required checks、Actions/Release 权限、网站的固定快照读取与校验、通知凭据范围、Cloudflare 构建设置、部署版本记录和回退演练。本地通过只证明本地流程；没有云端运行证据时应报告“快照已生成，官网连接未配置/未验证”。
