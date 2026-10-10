# Data Publication and Website Preview

[Chinese version](deployment.zh.md)

Contributors submit a README and optional cover. CI generates website JSON and publishes it with Cloudflare Workers Static Assets. The website stays on Cloudflare Pages and reads the data at runtime.

## From PR to the website

1. PR CI checks the content, resolves upstream Skills, and builds a preview package.
2. Maintainers review the content and merge the PR into `main`.
3. Publication CI verifies the merged PR and prepares a complete production package.
4. CI deploys the package. Visitors refresh the website to read its new `current.json`.

CI reads the previous published snapshot through `CATALOG_DATA_BASE_URL`. Unchanged input retains its source commits, identities, and revision history. Production contains complete, active, approved records. Verification and testing states reflect actual evidence.

The package includes versioned JSON, shared local covers, and browser cache and cross-origin access headers. Identical images share one content hash. Cloudflare reuses matching assets during deployment. Static requests and asset storage are free under the [Static Assets pricing rules](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).

The project caps JSON files at 20 MiB, below Cloudflare's [25 MiB single-file limit](https://developers.cloudflare.com/changelog/post/2025-09-02-increased-static-asset-limits/). Each snapshot has a total file size limit of 100 MiB.

Each deployment retains the current and preceding data versions. Repeating the same version verifies the existing deployment. Refresh pages kept open across multiple data publications to read the current data.

## Configure publication

Use the Cloudflare Workers Free plan. The Worker name is `skills-hub-collections` in `wrangler.jsonc`.

1. Find the [Cloudflare account ID](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/).
2. Open [Cloudflare API tokens](https://dash.cloudflare.com/?to=/:account/api-tokens). Select the **Edit Cloudflare Workers** template and scope it to this account. Save the token as `CLOUDFLARE_API_TOKEN` in the [collection repository's Actions secrets](https://github.com/qufei1993/awesome-skills/settings/secrets/actions). Keep the token value in that secret store.
3. Add these [collection repository variables](https://github.com/qufei1993/awesome-skills/settings/variables/actions):

| Variable | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `CATALOG_DATA_BASE_URL` | Public data root, such as `https://skills-hub-collections.YOUR_SUBDOMAIN.workers.dev` |

Replace `YOUR_SUBDOMAIN` with the account's Workers subdomain. A custom domain may also serve as the public data root. See [Workers domains](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

4. Merge the publication PR. Check its publication workflow and `<public data root>/current.json`.
5. In the [website repository's variables](https://github.com/qufei1993/skills-hub-web/settings/variables/actions), set `VITE_COLLECTIONS_BASE_URL` to this data root. Deploy the website once to connect the address.

Later collection merges update data independently. Deploy the website again when its data address changes. Publication jobs run one at a time and check the latest `main` before deploying.

## Test a PR

Use Node.js 22 or later and Git. Run these commands from the collection repository:

```sh
npm ci
npm run check
npm run package:data -- --from dist/collections --output dist/assets --preview
npm run deploy:data -- --dry-run
```

The dry run checks the deployment package locally. PR CI also serves the package with the Cloudflare local runtime and checks file integrity, cross-origin access, caching, and missing files. It uploads preview files for review. For same-repository PRs, configuring the account variable and Actions secret also enables a cloud preview named `skills-hub-collections-pr-<PR number>`. Its data URL appears in the CI summary.

## Preview the website locally

The website checkout must exist at the selected path.

```sh
npm --prefix ../skills-hub-web ci
npm run dev:site -- --site ../skills-hub-web
```

Open [the local collections page](http://127.0.0.1:8775/collections). The data server uses port 8776. Edit a summary, check the page, then restore it and check again. Valid README or local cover changes update the preview.

Automated browser verification uses Google Chrome:

```sh
npm run test:site -- --site ../skills-hub-web
```

`VITE_COLLECTIONS_ALLOW_PREVIEW=true` allows preview data in local and test environments. See [data rules](format.md) for generation and review.
