# Snapshot Publication and Website Synchronization

Markdown is the content source. After merging to main, the workflow generates a production snapshot tied to that commit. The website updates its index, details, and covers from the complete snapshot. This repository provides workflow files; **it does not establish that GitHub required checks, Release write permissions, cross-repository notifications, or a Cloudflare project are configured**. Without a user request to deploy, perform local validation only; do not create cloud projects or push the repository.

## PR and merge requirements

`validate.yml` uses `pull_request` and supports `merge_group` when merge queue is enabled. Both events grant only `contents: read`, provide no deployment secrets, and do not use `pull_request_target` to execute submission code. GitHub recommends that required workflows for merge queue also respond to merge_group. [GitHub event documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

`validate` runs Node.js 22, `npm ci`, `npm run check`, and target-branch baseline validation. `publish-readiness` checks production requirements for approved records; pending submissions may still pass. The event's fixed base SHA is checked out separately and supplied through `--base-dir` to verify permanent identities during updates.

Maintainers must require human review and successful `validate` and `publish-readiness` checks in GitHub rulesets or branch protection. Workflow success establishes structural and record completeness; humans decide inclusion, and actual testing has separate evidence. The three migrated records are currently pending: preview includes three, while production exports zero. Do not claim these collections are online before verification and approval.

## Generation and storage

```sh
npm ci
npm run check
npm run validate:publish
npm run build -- --output dist/collections --source-revision FULL_COMMIT_SHA
```

`FULL_COMMIT_SHA` is the full 40-character data repository commit SHA for this build. The generated directory contains `index.json`, details, archived assets, and `manifest.json`. The manifest uses `schemaVersion: 1`, `preview`, `sourceRevision`, and `files`. Each file records its relative `path`, `sha256`, and `size`. The manifest does not list itself. Preview snapshots have `preview: true` and are explicitly rejected by production website synchronization.

`publish.yml` publishes only for pushes to main or manual workflow_dispatch runs on main. It validates and generates data, uploads an Actions artifact named with the SHA, then creates a `snapshot-<SHA>` GitHub Release containing `catalog.zip` and `catalog.zip.sha256`. The archive has no enclosing directory. The Release job separately uses `contents: write`; PR jobs remain read-only. Existing Releases are not overwritten. On reruns, inspect the existing result instead of replacing the same SHA's content. Immutability here is a publishing convention, not a guarantee preventing repository administrators from deleting files.

The website remotely reads a fixed tag of a public Release without running data repository code. The sync tool verifies the tag's revision, GitHub asset URLs, and manifest.sourceRevision. [GitHub Release-by-tag API](https://docs.github.com/en/rest/releases/releases#get-a-release-by-tag-name)

Do not manually commit generated output into `collections/` or treat a floating default-branch URL as a published version. Actions artifacts support CI review and downloads; use the Release assets above for persistent retrieval by SHA. Publication failures do not trigger website notifications.

## Local and fixed-version synchronization

```sh
# Use a complete production snapshot; TARGET_WEBSITE is the website repository root.
npm run sync:site -- --from dist/collections --target TARGET_WEBSITE

# Fetch a fixed Release from the specified data repository using a full 40-character SHA.
npm run sync:site -- --repo OWNER/REPO --ref FULL_COMMIT_SHA --target TARGET_WEBSITE
```

Choose either `--from` or `--repo/--ref`. The sync tool validates the manifest, file sizes, SHA256 checksums, fixed data revision, and path boundaries. It rejects previews, prepares the complete replacement in a temporary directory, then replaces the website's `public/data/collections` together. Failure retains the previous target. Do not copy only the index or supplement covers from a different version.

The previous version is stored at `.catalog-sync/previous` under the website root. The sync lock is also in `.catalog-sync/`. Add this directory to the website repository's ignore rules. A rename preserves the backup before switching; failure during the critical switch restores the old target. If cleanup of an older backup fails after a successful switch, the tool returns `cleanupPending: true`, while the new snapshot and the previous rollback snapshot remain complete. Confirm no sync process is running before cleaning leftover backups.

To test preview synchronization, explicitly add `--preview` and use only a temporary test website directory. This option must not be used for production website deployment.

The website build still runs its own data validation and build commands. Record the manifest's `sourceRevision` in deployment logs or build metadata. An accepted trigger does not mean deployment succeeded. Verify website deployment status and the online data revision before reporting synchronization complete. Visitors receive the new complete version after refreshing.

The current `skills-hub-web` `scripts/collections-plugin.mjs` regenerates data from the website's own `content/collections/` when Vite configuration loads. Integration with this repository must change that step to validate the synchronized snapshot and disable local JSON export and its file watcher. Otherwise, the website build overwrites newly synchronized data. Integration acceptance must compare the output manifest, index, details, and covers again after the complete website build. This task did not modify the website repository under active development; current validation covers the generated data contract and synchronization into temporary directories.

## Optional cross-repository notifications

Without a notification mode, the workflow explicitly reports `disabled` and does not claim the website changed. Set repository variable `SITE_NOTIFICATION_MODE` to `repository_dispatch` or `cloudflare_hook`. Selecting a mode without its required configuration, or receiving a failed response, fails the notification step. Configuration belongs only in the main publishing notification job, never in the PR environment.

| Mode | Repository variable | Secret | Website integration |
| --- | --- | --- | --- |
| `repository_dispatch` | `SITE_REPOSITORY=owner/repo` | `SITE_DISPATCH_TOKEN` | Receive `catalog_snapshot`, validate the source repository and `client_payload.sourceRevision`, and fetch the same SHA's Release |
| `cloudflare_hook` | No additional variable | `CLOUDFLARE_DEPLOY_HOOK` | Resolve the latest approved snapshot to a fixed SHA before fetching all files for that SHA |

Prefer repository_dispatch because its request carries the data repository, fixed SHA, Release tag, and manifest checksum. Use a fine-grained token or GitHub App installation token authorized only for the target website repository, with that repository's `Contents: write` permission as required by the dispatch API. Avoid long-lived credentials able to write arbitrary repositories. GitHub supports repository_dispatch for external activity. [GitHub Dispatch API and permissions](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event)

A Cloudflare Pages Deploy Hook URL is itself a credential and must be stored in secrets. Workflows report status only; they must not print the URL, token, or response body. [Cloudflare Deploy Hooks](https://developers.cloudflare.com/pages/configuration/deploy-hooks/)

Deploy Hook does not guarantee the website uses a supplied data SHA. The website must first resolve the latest approved Release, lock one SHA, and fetch, validate, and build the same snapshot. Do not resolve latest again during the build or mix a floating branch's index with pinned details. For concurrent events, control the website publishing queue so an older version cannot replace a newer deployment.

## Rollback and outstanding configuration

To roll back, select the previous complete `snapshot-<SHA>`, synchronize with fixed `--ref`, build, and redeploy. Retain the original snapshot for auditing. Locally, `npm run sync:site -- --rollback --target TARGET_WEBSITE` restores the previous complete snapshot saved by the sync tool. Do not revert only the index.

Before going live, confirm GitHub human review and required checks, Actions/Release permissions, fixed-snapshot consumption and validation on the website, notification credential scope, Cloudflare build configuration, deployment revision records, and a rollback exercise. Local success proves only the local process. Without cloud execution evidence, report that the snapshot was generated and the website connection remains unconfigured or unverified.
