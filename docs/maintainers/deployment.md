# Data Publication and Local Website Preview

[Chinese version](deployment.zh.md)

Contributors edit one readable collection README. Maintainers combine its five presentation fields with retained `.catalog` data, build a complete snapshot, and publish it for the website to read at runtime. See [internal data notes](format.md).

## Publication eligibility

Production includes complete, active, approved records and rejects failed installation or workflow results. Existing display approval is separate from source, file, resource, image-rights, and test evidence. `needs-review` and `not-tested` remain unchanged and visible. The three migrated website collections retain their user approval and export to production; display/install counts remain 13/13, 31/31, and 3/14.

Pending records are excluded from production. Explicit previews may include complete pending records; incomplete README-only submissions remain excluded from all snapshots. Checks validate structure and recorded data without fetching upstream Skills, executing them, or downloading remote covers.

## Build and publish locally

```sh
npm ci
npm run check
npm run validate:publish
npm run build -- --output dist/collections --source-revision FULL_COMMIT_SHA
npm run publish:data -- publish --from dist/collections --to dist/published
```

`FULL_COMMIT_SHA` is the full 40-character source commit. The raw snapshot format stays unchanged: `index.json`, collection details, archived assets, and `manifest.json`. Every manifest entry records its path, SHA256, and size; the manifest does not list itself.

The publisher verifies the snapshot before writing a distribution. The publication version is the SHA256 of the exact manifest bytes, while `sourceRevision` remains the source commit. These are different identifiers.

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

`current.json` points to `snapshots/<version>/` and contains an `assets` map from archived logical paths, such as `assets/<collection-id>/cover.png`, to shared image objects. JSON bytes are preserved; raw cover URLs keep their logical paths, resolved by the website through the map. Only archived images enter this mapping; HTTPS covers remain direct URLs without downloading or uploading them. Unchanged archived images are uploaded only once across versions. All files are ready before `current.json` switches; failed publication retains the previous pointer.

For a manual preview, build with `npm run build:preview` and add `--preview` to publication. Production consumers reject previews unless explicitly configured for local testing.

## Preview with the existing website

Install dependencies in both checkouts first. The website checkout must be available at the selected path.

```sh
npm ci
npm --prefix ../skills-hub-web ci
npm run dev:site -- --site ../skills-hub-web
```

The command builds and publishes a preview, serves local data, and starts the existing website. Default ports are 8775 for the website and 8776 for data. It watches collection READMEs, archived covers, and internal metadata; changes publish a complete version and update the running website. Failed updates leave the last valid data available. Website source changes continue through normal Vite HMR.

To check propagation, temporarily change a collection's opening summary, confirm the new summary and publication version in the browser, then restore the file and confirm the original returns. Preserve unrelated edits. This needs no commit or upload.

For automated verification, install Google Chrome, then run `npm run test:site -- --site ../skills-hub-web`. Playwright is a declared development dependency. The check uses temporary copies and tests the list, details, automatic updates, image reuse, failed publication, and rollback without changing the real collections.

Production website configuration uses `VITE_COLLECTIONS_BASE_URL` pointing to the data root containing `current.json`. `VITE_COLLECTIONS_ALLOW_PREVIEW=true` permits previews only in local/test environments. Without a remote base URL, the existing local snapshot path remains available.

## Optional R2 publication

```sh
npm run publish:data -- publish --from dist/collections --r2
```

Supply the following runtime environment variables through deployment configuration:

| Variable | Value |
| --- | --- |
| `CATALOG_R2_ACCOUNT_ID` | Cloudflare account ID |
| `CATALOG_R2_BUCKET` | Data bucket name |
| `CATALOG_R2_ACCESS_KEY_ID` | R2 access key from the secret store |
| `CATALOG_R2_SECRET_ACCESS_KEY` | R2 secret key from the secret store |

R2 uses the same snapshot and shared-image layout. Serve the bucket through a public data endpoint and set the website's base URL to it, allowing the website origin to read the files. Preview upload also requires `--preview --test-destination` and belongs only in a test destination. The production workflow does not enable previews.

Concurrent publication or rollback uses a conditional pointer update. If another operation switches the pointer first, this operation fails and keeps the successful version.

For CI, set repository variable `CATALOG_PUBLICATION_MODE=r2`, account and bucket variables, and the two access-key secrets above. Without the mode, the workflow reports data upload disabled. An enabled mode with incomplete configuration fails. The workflow retains fixed-commit raw snapshot artifacts and Release compatibility; it serializes publication, checks the latest main commit before uploading, and reads it again after all immutable files are ready, immediately before the conditional `current.json` update. A revision that became stale skips the pointer update and reports this in the workflow summary; its immutable objects remain safe to reuse. A failed final check also leaves the pointer unchanged. This final GitHub check and the R2 conditional write reduce the race window; they do not form an atomic transaction across the two services. Local publication and previews do not read GitHub. The website reads the data at runtime and needs no rebuild notification.

Local files and checks establish local success. The bucket/public endpoint, GitHub required checks, credentials, and website configuration are deployment settings. Report cloud publication or online updates only after verifying the actual endpoint and version.

## Compatibility and rollback

Direct snapshot-copy synchronization remains supported:

```sh
npm run sync:site -- --from dist/collections --target ../skills-hub-web
npm run sync:site -- --repo OWNER/REPO --ref FULL_COMMIT_SHA --target ../skills-hub-web
npm run sync:site -- --rollback --target ../skills-hub-web
```

The copy tool verifies the complete snapshot and replaces `public/data/collections` together, retaining the previous version in `.catalog-sync/previous`. Add `.catalog-sync/` to the website ignore rules. `--preview` is explicit and local/test only. For runtime publication, switch to a retained, verified version:

```sh
npm run publish:data -- rollback --to dist/published --version VERSION_SHA256
```

Retain published snapshots and images for rollback. Restore a complete pointer or snapshot; keep indexes, details, and images from the same version. Pushes, pull requests, and cloud deployment follow the user's request.
