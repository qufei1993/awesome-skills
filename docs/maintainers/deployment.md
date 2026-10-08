# Data Publication and Website Preview

[Chinese version](deployment.zh.md)

Contributors submit a README and optional cover. CI resolves upstream Skill links and generates website JSON. See [data rules](format.md).

## From PR to the website

1. PR CI checks the README format, resolves upstream Skills, and builds a preview.
2. Maintainers review the content and merge the PR into `main`.
3. Publication CI verifies the merged PR, builds production data, and uploads it to R2.
4. After all files are ready, CI updates `current.json`. Visitors refresh the website to read the new version.

R2 keeps complete snapshots and shared images. CI reads the previous snapshot through `CATALOG_DATA_BASE_URL`. Unchanged input retains its source commits, identities, and version history. Failed publication keeps the previous current version.

Previews include pending records. Production data contains complete, active, approved records. Installation and workflow states reflect actual evidence; failed results block publication.

## Configure R2 and the website

Complete these four steps before merging the publication PR.

### 1. Create a bucket

Open [Cloudflare R2](https://dash.cloudflare.com/?to=/:account/r2/overview) and create a bucket, for example `skills-hub-collections`. Use Standard storage and the default jurisdiction. Record the account ID and bucket name. See [bucket creation](https://developers.cloudflare.com/r2/buckets/create-buckets/).

### 2. Create upload credentials

On the R2 overview page, open **API Tokens → Manage**. Create a token with **Object Read & Write** permission and scope it to this bucket. Copy its keys into the [collection repository's Actions secrets](https://github.com/qufei1993/awesome-skills/settings/secrets/actions):

| Secret | Value |
| --- | --- |
| `CATALOG_R2_ACCESS_KEY_ID` | Access Key ID |
| `CATALOG_R2_SECRET_ACCESS_KEY` | Secret Access Key |

Keep credentials in GitHub secrets. The secret access key is shown once. See [R2 credentials](https://developers.cloudflare.com/r2/api/tokens/).

### 3. Set the public data address

Open the bucket's **Settings → Custom Domains → Add**. Connect a domain such as `collections.aiskillshub.link`. Its domain must belong to the same Cloudflare account. Wait for the status to become **Active**. See [custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/).

In **Settings → CORS Policy**, use the JSON editor to allow browsers to read the public data:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"]
  }
]
```

See [CORS configuration](https://developers.cloudflare.com/r2/buckets/cors/). Publication sets `current.json` to `Cache-Control: no-store`. Preserve this setting in Cloudflare cache rules.

### 4. Connect CI and the website

In the [collection repository's Actions variables](https://github.com/qufei1993/awesome-skills/settings/variables/actions), add:

| Variable | Value |
| --- | --- |
| `CATALOG_R2_ACCOUNT_ID` | Cloudflare account ID |
| `CATALOG_R2_BUCKET` | Bucket name |
| `CATALOG_DATA_BASE_URL` | Public data root, such as `https://collections.aiskillshub.link` |
| `CATALOG_PUBLICATION_MODE` | `r2`; set this last to enable uploads |

In the [website repository's Actions variables](https://github.com/qufei1993/skills-hub-web/settings/variables/actions), set `VITE_COLLECTIONS_BASE_URL` to the same public data root. After the first successful R2 publication, deploy the website once to connect this address. Later collection updates use R2 data at runtime. Deploy the website again when this address changes.

Before upload mode is enabled, CI validates the data and skips uploading. Enabling `r2` requires every setting above; incomplete settings fail publication. After configuration, merge the publication PR to upload the initial version. Check `<public data root>/current.json`, then deploy the website and check its collections.

Publication runs one job at a time. CI checks the latest `main` before upload and before switching `current.json`. A stale revision skips the switch. GitHub revision checks and the R2 conditional write are separate operations.

## Preview locally

Use Node.js 22 or later. The website checkout must exist at the selected path.

```sh
npm ci
npm --prefix ../skills-hub-web ci
npm run dev:site -- --site ../skills-hub-web
```

This generates a preview, serves its data, and starts the website. Default ports are 8775 for the website and 8776 for data. Valid README or local cover changes update the preview; failed changes keep the previous data available.

Temporarily change a summary, check the website, then restore it and check again. Automated verification uses Google Chrome: `npm run test:site -- --site ../skills-hub-web`.

`VITE_COLLECTIONS_ALLOW_PREVIEW=true` allows preview data in local and test environments. An unset external data address uses the website's local snapshot.

## Build and publish files locally

```sh
npm run check
npm run build:preview -- --output dist/collections --source-revision FULL_COMMIT_SHA
npm run publish:data -- publish --from dist/collections --to dist/published --preview
```

Replace `FULL_COMMIT_SHA` with the full 40-character source commit. Builds need network access. `npm run validate` checks README format offline; add `--resolve-upstream` to resolve sources.

For an approved production snapshot, use `npm run build` and omit `--preview` from publication. New collections stay pending in local builds. Trusted CI verifies the reviewed PR merge before approval.

Published files include `current.json`, complete snapshots under `snapshots/<version>/`, and shared images under `images/<SHA256>.<ext>`. The version is the SHA256 of the manifest bytes; `sourceRevision` is the source commit. Identical local images share one uploaded object. HTTPS covers retain direct links.

For a manual upload of a verified production snapshot, securely provide the R2 settings and run:

```sh
npm run publish:data -- publish --from dist/collections --r2
```

Preview uploads require `--preview --test-destination` and a test destination.

## Local rollback and snapshot copying

Keep published snapshots and images. Switch a local publication to a verified version, or copy a snapshot into the website checkout:

```sh
npm run publish:data -- rollback --to dist/published --version VERSION_SHA256
npm run sync:site -- --from dist/collections --target ../skills-hub-web
npm run sync:site -- --rollback --target ../skills-hub-web
```

The copy tool verifies and replaces `public/data/collections` together. It keeps the previous version in `.catalog-sync/previous`; ignore `.catalog-sync/` in the website checkout. Add `--preview` for local or test copies. Restore whole versions so indexes, details, and images stay consistent.
