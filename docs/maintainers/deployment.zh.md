# 数据发布与官网预览

[英文版](deployment.md)

贡献者提交 README 和可选封面。CI 解析上游技能链接，生成官网 JSON。详见[数据规则](format.zh.md)。

## 从 PR 到官网

1. PR 的 CI 检查 README 格式，解析上游技能并生成预览。
2. 维护者审核内容，将 PR 合并到 `main`。
3. 发布 CI 核对已合并的 PR，生成正式数据并上传到 R2。
4. 全部文件准备完成后，CI 更新 `current.json`。访客刷新官网后读取新版本。

R2 保留完整快照和共享图片。CI 通过 `CATALOG_DATA_BASE_URL` 读取上一次快照。输入不变时，保留来源提交、稳定身份和版本历史。发布失败时，继续使用上一份当前版本。

预览包含待审记录。正式数据包含资料完整、有效且审核通过的记录。安装和流程状态以实际依据为准；实测失败时阻断发布。

## 配置 R2 与官网

合并发布流程的 PR 前，完成以下四步。

### 1. 创建数据桶

打开 [Cloudflare R2](https://dash.cloudflare.com/?to=/:account/r2/overview)，创建数据桶，例如 `skills-hub-collections`。选择标准存储和默认管辖区。记下账户 ID 和桶名。详见[创建数据桶](https://developers.cloudflare.com/r2/buckets/create-buckets/)。

### 2. 创建上传密钥

在 R2 概览页打开 **API Tokens → Manage**。创建具有 **Object Read & Write（对象读写）** 权限的令牌，并限定为这个数据桶。将密钥填入[合集仓库的密钥设置](https://github.com/qufei1993/awesome-skills/settings/secrets/actions)：

| 密钥名称 | 内容 |
| --- | --- |
| `CATALOG_R2_ACCESS_KEY_ID` | Access Key ID（访问密钥 ID） |
| `CATALOG_R2_SECRET_ACCESS_KEY` | Secret Access Key（私密访问密钥） |

凭据保存在 GitHub 密钥中。私密访问密钥只显示一次。详见 [R2 密钥说明](https://developers.cloudflare.com/r2/api/tokens/)。

### 3. 设置公开数据地址

打开数据桶的 **Settings → Custom Domains → Add（设置 → 自定义域名 → 添加）**，绑定域名，例如 `collections.aiskillshub.link`。域名须由同一个 Cloudflare 账户管理。等待状态变为 **Active（已启用）**。详见[自定义域名](https://developers.cloudflare.com/r2/buckets/public-buckets/)。

在 **Settings → CORS Policy（设置 → 跨域访问规则）** 的 JSON 编辑器中填写以下规则，允许浏览器读取公开数据：

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"]
  }
]
```

详见[跨域访问配置](https://developers.cloudflare.com/r2/buckets/cors/)。发布程序已为 `current.json` 设置 `Cache-Control: no-store`，表示不缓存。配置 Cloudflare 缓存规则时保留此设置。

### 4. 连接 CI 与官网

在[合集仓库的变量设置](https://github.com/qufei1993/awesome-skills/settings/variables/actions)中添加：

| 变量名称 | 内容 |
| --- | --- |
| `CATALOG_R2_ACCOUNT_ID` | Cloudflare 账户 ID |
| `CATALOG_R2_BUCKET` | 数据桶名称 |
| `CATALOG_DATA_BASE_URL` | 公开数据根地址，例如 `https://collections.aiskillshub.link` |
| `CATALOG_PUBLICATION_MODE` | `r2`；最后设置，开启自动上传 |

在[官网仓库的变量设置](https://github.com/qufei1993/skills-hub-web/settings/variables/actions)中，将 `VITE_COLLECTIONS_BASE_URL` 设为同一个公开数据根地址。R2 首次发布成功后，部署官网一次以接入这个地址。之后更新合集时，官网运行时读取 R2 数据。更改此地址后，重新部署官网。

开启上传前，CI 校验数据并跳过上传。开启 `r2` 后，需填齐上述配置；配置缺失时发布失败。配置完成后，合并发布流程的 PR，上传初始版本。先检查 `<公开数据根地址>/current.json`，再部署官网并检查合集。

发布任务逐个执行。CI 在上传前和切换 `current.json` 前检查 `main` 最新提交。来源提交过旧时跳过切换。GitHub 提交检查与 R2 条件写入分别执行。

## 本地预览

使用 Node.js 22 或更高版本。指定路径须有官网项目。

```sh
npm ci
npm --prefix ../skills-hub-web ci
npm run dev:site -- --site ../skills-hub-web
```

此命令生成预览，提供数据服务并启动官网。默认官网端口为 8775，数据端口为 8776。有效的 README 或本地封面修改会更新预览；修改失败时继续提供上一份数据。

临时修改一份短简介，在官网确认效果，再恢复并再次确认。自动验证使用 Google Chrome：`npm run test:site -- --site ../skills-hub-web`。

`VITE_COLLECTIONS_ALLOW_PREVIEW=true` 允许本地和测试环境读取预览数据。外部数据地址留空时，官网使用本地快照。

## 本地生成与发布文件

```sh
npm run check
npm run build:preview -- --output dist/collections --source-revision FULL_COMMIT_SHA
npm run publish:data -- publish --from dist/collections --to dist/published --preview
```

将 `FULL_COMMIT_SHA` 替换为完整的 40 位来源提交。生成数据需要联网。`npm run validate` 离线检查 README 格式；增加 `--resolve-upstream` 后解析来源。

生成已审核的正式快照时，使用 `npm run build`，发布命令省略 `--preview`。本地生成的新合集保持待审。可信 CI 核对已审核的 PR 合并后授予审批。

发布文件包含 `current.json`、`snapshots/<version>/` 下的完整快照和 `images/<SHA256>.<ext>` 下的共享图片。版本是清单原始字节的 SHA256；`sourceRevision` 是来源提交。相同本地图片共用一个已上传对象。HTTPS 封面保留直链。

手动上传已验证的正式快照时，安全提供 R2 配置，再运行：

```sh
npm run publish:data -- publish --from dist/collections --r2
```

预览上传需要 `--preview --test-destination` 和测试目标。

## 本地回退与快照复制

保留已发布快照和图片。将本地发布切换到已验证的版本，或将快照复制到官网目录：

```sh
npm run publish:data -- rollback --to dist/published --version VERSION_SHA256
npm run sync:site -- --from dist/collections --target ../skills-hub-web
npm run sync:site -- --rollback --target ../skills-hub-web
```

复制工具验证后整体替换 `public/data/collections`。上一版保存在 `.catalog-sync/previous`；官网仓库应忽略 `.catalog-sync/`。本地或测试复制增加 `--preview`。整体恢复版本，确保索引、详情和图片一致。
