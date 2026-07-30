# M3 Bundled Git Runtime Delivery

- Date: 2026-07-28
- Updated: 2026-07-30
- Scope: fixed runtime delivery, four-architecture packaging, controlled version saving, history/diff review, local branch switching, and task recovery
- Status: local version-management foundations complete; four-architecture recovery qualification, network, credentials, and release-signing evidence remain open

## Implemented delivery contract

- The manifest fixes Git 2.55.0 for macOS and Git for Windows 2.55.0.windows.3 for Windows, with a source URL and SHA-256 for every input.
- Windows x64 and arm64 use official MinGit archives and preserve their complete architecture, helper, CA, template, shell, and license directories.
- macOS x64 and arm64 build the official kernel.org source on a matching host architecture. The build disables optional Perl, Python, Tcl/Tk, gettext, and OpenSSL dependencies, uses Apple CommonCrypto and system libcurl, and targets macOS 12.0.
- Archive entries are checked for absolute paths and traversal before extraction. Existing invalid runtime directories are never overwritten automatically.
- macOS helper symlinks remain relative and compact. Manifest-required files are materialized only after their resolved targets are proven to stay inside the runtime root, so required-path verification remains symlink-free without expanding every Git builtin during packaging.
- Every runtime carries target/version/source metadata. Verification checks required file types and runs init, add, commit, switch, diff, and log on matching hosts.
- Electron packages copy only the prepared target runtime to `resources/git` outside `app.asar`. The main process injects the runtime's exec path, templates, and CA bundle without exposing them to Renderer IPC.
- Strict `version:list` and `version:diff` IPC contracts expose at most 100 commit summaries and a bounded structured diff. Diff requests accept only full hexadecimal commit IDs, use the selected commit's first parent, and disable shell execution, external diff drivers, and text conversion.
- The change-review workspace now lists repository history, file-level addition/deletion counts, binary-file state, and a syntax-colored unified diff. Reading a project without `.git` returns an empty history and does not initialize a repository.
- Strict `version:branch-list` and `version:branch-switch` IPC contracts expose only bounded local branch summaries and exact local-branch selection. Branch changes share the project operation queue, reject staged, unstaged, and untracked changes or a recoverable Agent task, and never accept a revision, remote name, repository path, or Git arguments from Renderer.
- The change-review workspace provides a local branch selector. It is disabled for unsaved editor content and active task recovery, and a successful switch reloads the project structure, current document, and branch-specific version history.
- `TaskSnapshotService` stores task manifests and content-addressed blobs outside the repository with user-only permissions, per-file/task storage limits, one open task per project, and a write-ahead mutation ledger. Its internal write/delete methods reject absolute paths, traversal, `.git`, symlinks, and non-regular files.
- Restore processes mutations in reverse order without changing refs, `HEAD`, or the Git index. It restores exact Agent after-images, preserves clean non-overlapping UTF-8 user edits through reverse three-way merge, blocks `HEAD` drift, reports index drift and overlapping/binary/create-delete conflicts, persists progress after every mutation, and supports idempotent retry.
- Renderer IPC exposes only recovery listing and restore-by-project/task ID. It does not expose snapshot creation, Agent file mutation, repository paths, snapshot content, hashes, Git arguments, or a general filesystem/Git primitive. Saving versions and restoring tasks share a project operation queue.
- The change-review workspace shows recoverable tasks and complete/partial/blocked results. Recovery is disabled while the current document has unsaved edits, and a successful restore reloads the current document without leaving the review workspace.

## Current evidence

- Git for Windows release metadata provided SHA-256 values for both MinGit archives; both downloaded archives matched those values during source inspection.
- The macOS arm64 source build produced and qualified Git 2.55.0 from the pinned source and CA bundle. The relocated runtime completed init, add, commit, switch, diff, and log operations and linked only Apple frameworks and system libraries.
- The macOS arm64 Electron package completed successfully. Its packaged `Contents/Resources/git/bin/git` is an executable arm64 Mach-O, the packaged runtime requalified successfully, and the packaged application passed the Electron readiness smoke test.
- Preserving internal helper symlinks reduced the packaged Git runtime from an invalid 803 MB hardlink-expanded result to 48 MB. The complete local `.app` is 363 MB before signing.
- Runtime tooling tests passed 3/3. Repository boundaries, lint, type checking, all workspace unit tests, all seven workspace builds, and Electron Playwright tests (6/6) passed with Node.js 24.16.0 and pnpm 11.7.0.
- GitHub Actions run [30420297175](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30420297175) passed macOS x64/arm64 and Windows x64/arm64 packaging. Every target passed runtime qualification, its platform-specific packaged-path assertion, and artifact upload. macOS targets and Windows x64 also passed packaged application smoke tests; Windows arm64 retained its explicit startup-evidence gap.
- Quality run [30420297168](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30420297168) passed repository formatting, boundaries, lint, type checking, tests, builds, and Electron E2E. Lint reports four existing Fast Refresh warnings and no errors. Generated pnpm lockfiles are excluded from Prettier to avoid formatter/package-manager churn.
- Local packaging was unsigned because no Developer ID identity is installed; signing and notarization remain release evidence, not local qualification.
- Local `pnpm verify` passed after the history/diff implementation: version contracts pass 22/22, desktop unit tests pass 41/41, all seven workspace builds pass, and Electron Playwright passes 6/6 including a real save-version -> history -> diff review flow with a Chinese project path.
- Local task-recovery validation passes formatting, workspace boundaries, Git runtime tests 3/3, all-workspace type checking/tests/builds 21/21, 26 contract tests, and 47 desktop tests. Dirty-repository integration covers staged, unstaged, mixed, and untracked task-start content; Agent-created/deleted files; non-overlapping and overlapping same-file edits; index and `HEAD` drift; idempotent retry; path/symlink rejection; storage budgets; and single-task locking.
- Electron Playwright passes 7/7 and covers a real save-version -> task snapshot -> controlled Agent write -> review restore flow. The test verifies both disk content and the reloaded editor, and the success-state screenshot was visually inspected.
- Local branch-switch validation passes 27 contract tests and 49 desktop tests. It covers empty repositories without implicit initialization, Chinese branches in a project path containing spaces, exact local-name selection, already-current behavior, missing-branch rejection, and dirty-repository rejection without changing `HEAD`.
- Electron Playwright remains 7/7 after adding a real `main` -> Chinese local branch -> `main` flow. The test verifies the branch-specific commit diff and editor content after each switch; the branch-switch screenshot was visually inspected.
- A focused production-service qualification now runs `GitService` branch switching and `TaskSnapshotService` dirty-state recovery against the prepared bundled runtime. It passes 2/2 locally on macOS arm64 with Chinese/space paths, exact branch selection, dirty rejection, staged-state preservation, Agent create/delete reversal, and task-start content restoration. The four-architecture packaging workflow now runs the same qualification after runtime verification; a fresh matrix run is still required before recording cross-platform evidence.

## Open exit conditions

- Add HTTPS and SSH fixture qualification, host fingerprint rejection, enterprise CA success/failure, credential-store integration, SBOM generation, and signing/notarization evidence.
- Record a successful fresh four-architecture run of the new branch-switch and task-recovery production-service qualification before treating the cross-platform version-management path as complete. Production Agent orchestration must use the internal snapshot/write/delete capability when M6 is implemented; no Renderer mutation channel should be added.
- Git for Windows MinGit contains `usr/bin/sh.exe` but not `bash.exe`. This satisfies the M3 Git subprocess scope, not the M6 Agent SDK Bash requirement. M6 must select and qualify an additional shell distribution or remove that product assumption.
