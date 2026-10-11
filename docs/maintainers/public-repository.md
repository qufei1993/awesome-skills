# Public repository maintenance

[Chinese version](public-repository.zh.md)

## Before changing visibility

Merge the public-facing documentation and license changes. Confirm the other active publication work has finished. Review all branches, tags, and reachable history for credentials and private material; checking only the current files is insufficient. Do not copy deployment secrets into repository files.

The MIT license applies to original code and original documentation. Preserve third-party license and attribution records. A recorded unknown license is not proof of permission.

## GitHub settings when the repository becomes public

The repository currently uses GitHub features whose availability depends on visibility and plan. Apply and read back these settings after changing visibility:

- Protect `main` with a ruleset or branch protection. Require pull requests and successful `validate` and `publish-readiness` checks. Require conversations to be resolved; block force pushes and deletion.
- Require a review from another maintainer when one is available. Do not require a self-approval that a sole maintainer cannot provide.
- Under Actions, require approval for workflow runs from all external contributors. Keep the default workflow token read-only and disallow Actions from approving pull requests.
- Keep cloud deployment secrets unavailable to fork pull requests. The existing `pull_request` workflow builds a downloadable preview for forks; cloud preview deployment is restricted to branches in this repository. Do not replace it with a privileged `pull_request_target` workflow that executes proposal code.

Check a fork pull request after these settings are applied: the run should await approval, validation should produce a preview, and cloud deployment should be skipped. Confirm that required checks prevent merging a failing PR.

## Directory and publication status

The root README is a source directory, not a publication status report. Preview builds must not add review labels to it. Actual review and verification states remain in generated data. Merging a reviewed PR grants publication approval; it does not establish that installation or workflows have been tested.

Run `npm run check` for repository changes. Publishing data and changing repository visibility are separate operations.
