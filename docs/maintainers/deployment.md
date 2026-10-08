# Data Publication and Website Preview

[Chinese version](deployment.zh.md)

Submit a README and optional cover. CI resolves its upstream Skill links and generates website JSON automatically. See [data rules](format.md).

## From PR to the website

1. PR CI checks the README format, resolves upstream Skills, and builds a preview snapshot.
2. Maintainers review the README and preview, then merge the PR into `main`.
3. Trusted publication CI verifies the merged PR with `--reviewed-main`, builds the production snapshot, and publishes to the configured destination.
4. The website reads the new `current.json` at runtime and loads the updated collection data.

A snapshot is a complete set of collection data and cover assets. PR artifacts are named `catalog-preview-<snapshot-SHA>` and remain available for 30 days. Each contains `catalog-preview.zip` and its SHA256 checksum at the archive root. CI verifies its files and binds `sourceRevision` to the checked-out commit; the workflow summary also identifies the PR head.

Previews include pending records for review. Production consumers require production snapshots with complete, active, approved records. Failed installation or workflow results block publication. Source, resource, rights, and test states reflect actual evidence; `needs-review` and `not-tested` remain visible.

The first publication creates the initial snapshot. For later publications, trusted CI uses `CATALOG_USE_RELEASE_BASELINE=1` to load the previous production Release snapshot. Unchanged input retains its source commits, identity, and version history. A resolution or publication failure keeps the previous published version.

## Preview locally

Use Node.js 22 or later and install dependencies in both checkouts. The website must exist at the selected path.

```sh
npm ci
npm --prefix ../skills-hub-web ci
npm run dev:site -- --site ../skills-hub-web
```

This generates a preview, serves its data, and starts the website. Default ports are 8775 for the website and 8776 for data. It watches READMEs and local covers. Valid changes publish a complete preview version; failed changes leave the previous data available.

Change an opening summary temporarily, check the website, then restore that edit and check again.

For automated website verification, install Google Chrome and run `npm run test:site -- --site ../skills-hub-web`. Tests use temporary copies and check lists, details, updates, image reuse, failed publication, and rollback.

## Build and publish files locally

```sh
npm run check
npm run build:preview -- --output dist/collections --source-revision FULL_COMMIT_SHA
npm run publish:data -- publish --from dist/collections --to dist/published --preview
```

Replace `FULL_COMMIT_SHA` with the full 40-character source commit. Build and preview commands resolve upstream data and need network access. `npm run validate` checks only README format offline; add `--resolve-upstream` to resolve sources.

For an already approved production snapshot, use `npm run build` and omit `--preview` from publication. Local builds keep new collections pending. The trusted merged-PR publication workflow uses `--reviewed-main` to approve them.

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

The publication version is the SHA256 of the manifest bytes; `sourceRevision` is the source commit. `current.json` selects the snapshot and maps local cover paths to shared image objects. Identical local images share one uploaded object. HTTPS covers remain direct links. Publication prepares all files before switching the pointer; failure preserves its previous value.

## Configure R2 and the website

Set these GitHub repository variables and secrets:

| Setting | Storage | Value |
| --- | --- | --- |
| `CATALOG_PUBLICATION_MODE` | Variable | `r2` |
| `CATALOG_R2_ACCOUNT_ID` | Variable | Cloudflare account ID |
| `CATALOG_R2_BUCKET` | Variable | Data bucket name |
| `CATALOG_R2_ACCESS_KEY_ID` | Secret | R2 access key ID |
| `CATALOG_R2_SECRET_ACCESS_KEY` | Secret | R2 secret access key |

Serve the bucket through a public endpoint that allows the website origin to read its files. Set the website's `VITE_COLLECTIONS_BASE_URL` to the data root containing `current.json`. Use `VITE_COLLECTIONS_ALLOW_PREVIEW=true` for local or test environments. An unset remote base URL selects the existing local snapshot path.

Set `CATALOG_PUBLICATION_MODE=r2` and complete the R2 settings to enable uploads. An unset mode keeps the snapshot artifact and Release available. Incomplete R2 settings fail publication. The workflow serializes publication and checks the latest `main` before upload and immediately before switching `current.json`. A stale revision skips that switch. GitHub revision checks and the R2 conditional pointer write are separate operations.

For a manual upload of a verified production snapshot, provide the same R2 variables securely and run:

```sh
npm run publish:data -- publish --from dist/collections --r2
```

Preview uploads additionally require `--preview --test-destination` and belong only in a test destination. Report cloud publication or website updates only after checking the actual public endpoint and version.

## Rollback and snapshot copying

Retain published snapshots and images. Switch runtime publication to a verified version:

```sh
npm run publish:data -- rollback --to dist/published --version VERSION_SHA256
```

Copy a complete snapshot into the website checkout:

```sh
npm run sync:site -- --from dist/collections --target ../skills-hub-web
npm run sync:site -- --repo OWNER/REPO --ref FULL_COMMIT_SHA --target ../skills-hub-web
npm run sync:site -- --rollback --target ../skills-hub-web
```

The copy tool verifies the complete snapshot and replaces `public/data/collections` together. It saves the previous version in `.catalog-sync/previous`; ignore `.catalog-sync/` in the website checkout. Add `--preview` only for local or test copies. Restore whole versions so indexes, details, and images remain consistent.
