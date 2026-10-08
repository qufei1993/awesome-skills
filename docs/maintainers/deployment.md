# Data Publication and Website Preview

[Chinese version](deployment.zh.md)

Submit a README and optional cover. CI resolves its upstream Skill links and generates website JSON automatically. No new `.catalog` file is required. See [data rules](format.md).

## From PR to the website

1. PR CI checks the README format, resolves upstream Skills, and builds a preview snapshot.
2. Maintainers review the README and preview, then merge the PR into `main`.
3. Trusted publication CI verifies the merged PR with `--reviewed-main`, builds the production snapshot, and publishes to the configured destination.
4. The website reads the new `current.json` at runtime. Collection data updates do not require a website rebuild.

A snapshot is a complete set of collection data and cover assets. PR artifacts are named `catalog-preview-<snapshot-SHA>` and remain available for 30 days. Each contains `catalog-preview.zip` and its SHA256 checksum, without a wrapping directory. CI verifies its files and binds `sourceRevision` to the checked-out commit; the workflow summary also identifies the PR head.

Checks alone do not grant approval. Previews retain pending records and are rejected by production consumers. Formal publication requires complete, active, approved records and rejects failed installation or workflow results. Source, resource, rights, and test evidence remain separate from approval; `needs-review` and `not-tested` remain visible.

Trusted CI uses `CATALOG_USE_RELEASE_BASELINE=1` to load the previous production Release snapshot. Unchanged input retains its source commits, identity, and version history. A resolution or publication failure keeps the previous published version.

## Preview locally

Use Node.js 22 or later and install dependencies in both checkouts. The website must exist at the selected path.

```sh
npm ci
npm --prefix ../skills-hub-web ci
npm run dev:site -- --site ../skills-hub-web
```

This generates a preview, serves its data, and starts the existing website. Default ports are 8775 for the website and 8776 for data. It watches READMEs, local covers, and compatibility metadata. Valid changes publish a complete preview version; failed changes leave the previous data available.

Change an opening summary temporarily, check the website, then restore it and check again. Preserve unrelated edits. This requires no commit or upload.

For automated website verification, install Google Chrome and run `npm run test:site -- --site ../skills-hub-web`. Tests use temporary copies and check lists, details, updates, image reuse, failed publication, and rollback.

## Build and publish files locally

```sh
npm run check
npm run build:preview -- --output dist/collections --source-revision FULL_COMMIT_SHA
npm run publish:data -- publish --from dist/collections --to dist/published --preview
```

Replace `FULL_COMMIT_SHA` with the full 40-character source commit. Build and preview commands resolve upstream data and need network access. `npm run validate` checks only README format offline; add `--resolve-upstream` to resolve sources.

For an already approved production snapshot, use `npm run build` and omit `--preview` from publication. New collections remain pending outside the trusted merged-PR publication workflow. Do not use `--reviewed-main` to approve a local build.

The raw snapshot contains `index.json`, collection details, archived covers, and `manifest.json`. The manifest records each file's path, SHA256, and size. Published files use this layout:

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

The publication version is the SHA256 of the manifest bytes; `sourceRevision` is the source commit. `current.json` selects the snapshot and maps local cover paths to shared image objects. Unchanged local images upload only once. HTTPS covers remain direct links and are never downloaded or uploaded. Publication prepares all files before switching the pointer; failure preserves its previous value.

## Configure R2 and the website

Set these GitHub repository variables and secrets:

| Setting | Storage | Value |
| --- | --- | --- |
| `CATALOG_PUBLICATION_MODE` | Variable | `r2` |
| `CATALOG_R2_ACCOUNT_ID` | Variable | Cloudflare account ID |
| `CATALOG_R2_BUCKET` | Variable | Data bucket name |
| `CATALOG_R2_ACCESS_KEY_ID` | Secret | R2 access key ID |
| `CATALOG_R2_SECRET_ACCESS_KEY` | Secret | R2 secret access key |

Serve the bucket through a public endpoint that allows the website origin to read its files. Set the website's `VITE_COLLECTIONS_BASE_URL` to the data root containing `current.json`. Only local or test environments may use `VITE_COLLECTIONS_ALLOW_PREVIEW=true`. Without a remote base URL, the existing local snapshot path remains available.

Without a publication mode, CI retains the snapshot artifact and Release but reports upload disabled. Enabled R2 publication fails if configuration is incomplete. The workflow serializes publication and checks the latest `main` before upload and immediately before switching `current.json`. A stale revision skips that switch. R2 uses a conditional pointer write; these checks do not form an atomic transaction across GitHub and R2.

For a manual upload of a verified production snapshot, provide the same R2 variables securely and run:

```sh
npm run publish:data -- publish --from dist/collections --r2
```

Preview uploads additionally require `--preview --test-destination` and belong only in a test destination. Report cloud publication or website updates only after checking the actual public endpoint and version.

## Rollback and compatibility

Retain published snapshots and images. Switch runtime publication to a verified version:

```sh
npm run publish:data -- rollback --to dist/published --version VERSION_SHA256
```

Direct snapshot copying remains available:

```sh
npm run sync:site -- --from dist/collections --target ../skills-hub-web
npm run sync:site -- --repo OWNER/REPO --ref FULL_COMMIT_SHA --target ../skills-hub-web
npm run sync:site -- --rollback --target ../skills-hub-web
```

The copy tool verifies the complete snapshot and replaces `public/data/collections` together. It saves the previous version in `.catalog-sync/previous`; ignore `.catalog-sync/` in the website checkout. Add `--preview` only for local or test copies. Restore whole versions so indexes, details, and images remain consistent.
