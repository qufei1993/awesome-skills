# 数据发布与官网预览

[英文版](deployment.md)

贡献者提交 README 和可选封面。CI 自动生成官网 JSON，通过 Cloudflare Workers Static Assets 发布静态文件。官网继续使用 Cloudflare Pages，在运行时读取数据。

## 从 PR 到官网

1. PR 的 CI 检查内容，解析上游技能并生成预览包。
2. 维护者审核内容，将 PR 合并到 `main`。
3. 发布 CI 核对已合并的 PR，准备完整的正式数据包。
4. CI 部署数据包。访客刷新官网后，通过新的 `current.json` 读取数据。

CI 通过 `CATALOG_DATA_BASE_URL` 读取上一份发布快照。输入不变时，保留来源提交、稳定身份和版本历史。正式数据包含资料完整、有效且审核通过的记录。核验与实测状态以实际依据为准。

数据包包含版本化 JSON、共享本地封面，以及浏览器缓存和跨域访问规则。相同图片共用一个内容哈希。Cloudflare 部署时复用已有的相同文件。静态请求和文件存储按[静态文件计费规则](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)免费。

项目限制每个 JSON 文件不超过 20 MiB、每份快照总量不超过 100 MiB，单文件限制低于 Cloudflare 的 [25 MiB 上限](https://developers.cloudflare.com/changelog/post/2025-09-02-increased-static-asset-limits/)。

每次部署保留当前版和前一版。重复发布相同版本时，校验已部署的数据。页面长时间打开并跨过多次数据发布后，刷新页面以读取当前数据。

## 配置发布

使用 Cloudflare Workers 免费方案。`wrangler.jsonc` 中的服务名称是 `skills-hub-collections`。

1. 查找 [Cloudflare 账户 ID](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)。
2. 打开 [Cloudflare 令牌设置](https://dash.cloudflare.com/?to=/:account/api-tokens)。选择编辑 Workers 的权限模板，并限定到这个账户。将令牌保存为[合集仓库密钥](https://github.com/qufei1993/awesome-skills/settings/secrets/actions) `CLOUDFLARE_API_TOKEN`。令牌值保存在密钥存储中。
3. 添加以下[合集仓库变量](https://github.com/qufei1993/awesome-skills/settings/variables/actions)：

| 变量名称 | 内容 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID |
| `CATALOG_DATA_BASE_URL` | 公开数据根地址，例如 `https://skills-hub-collections.YOUR_SUBDOMAIN.workers.dev` |

将 `YOUR_SUBDOMAIN` 替换为账户的 Workers 子域名。也可以使用自定义域名作为公开数据根地址。详见 [Workers 域名说明](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)。

4. 合并发布流程的 PR。检查发布任务和 `<公开数据根地址>/current.json`。
5. 在[官网仓库变量](https://github.com/qufei1993/skills-hub-web/settings/variables/actions)中，将 `VITE_COLLECTIONS_BASE_URL` 设为这个数据根地址。部署官网一次以接入该地址。

之后合并合集 PR 时独立更新数据。数据地址改变后，重新部署官网。发布任务逐个执行，并在部署前核对 `main` 最新提交。

## 测试 PR

使用 Node.js 22 或更高版本，并安装 Git。在合集仓库中按顺序运行：

```sh
npm ci
npm run check
npm run package:data -- --from dist/collections --output dist/assets --preview
npm run deploy:data -- --dry-run
```

`--dry-run` 表示本地模拟部署，用于检查部署包。PR 的 CI 还会用 Cloudflare 本地运行环境读取文件，检查文件校验、跨域、缓存和缺失文件响应，并上传预览文件供审核。同仓库 PR 配置账户变量和发布密钥后，CI 会部署名为 `skills-hub-collections-pr-<PR 编号>` 的云端预览。数据地址显示在 CI 摘要中。

## 本地预览官网

指定路径须有官网项目。

```sh
npm --prefix ../skills-hub-web ci
npm run dev:site -- --site ../skills-hub-web
```

打开[本地合集页面](http://127.0.0.1:8775/collections)。数据服务使用 8776 端口。修改一份短简介，确认页面效果，再恢复并再次确认。有效的 README 或本地封面修改会更新预览。

自动浏览器验证使用 Google Chrome：

```sh
npm run test:site -- --site ../skills-hub-web
```

`VITE_COLLECTIONS_ALLOW_PREVIEW=true` 允许本地和测试环境读取预览数据。生成与审核规则见[数据规则](format.zh.md)。
