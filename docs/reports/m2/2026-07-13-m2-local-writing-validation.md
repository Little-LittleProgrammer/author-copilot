# M2 Local Writing Validation

- Date: 2026-07-13
- Scope: M2 local project creation, import, navigation, editing, and save safety
- Status: Implemented on macOS arm64; Windows-native exit evidence remains open

## Implemented workflow

- Atomic local project registry with canonical project paths and stable project IDs.
- Fixed novel and screenplay templates with disk-derived structure navigation.
- Read-only Markdown import preview, unclassified-file preservation, in-place
  registration, independent copy import, and explicit duplicate-ID reassignment.
- Renderer access limited to typed business IPC; native paths remain in the main
  process and document access is restricted to authorized relative Markdown paths.
- Markdown editing with SHA-256 optimistic concurrency, same-directory temporary
  files, fsync plus rename publication, mode retention, and asynchronous
  `document-saved` events.
- Two-pane writing workspace with content, AI, and change-review tab containers,
  zh-CN/en-US strings, and light/dark themes.

## Automated evidence

`pnpm verify` passed on macOS arm64 with Node 24.16.0 and pnpm 11.7.0:

- Prettier and workspace-boundary checks passed.
- Lint and typecheck passed for all seven workspace packages.
- 50 unit, contract, integration, and configuration tests passed.
- All seven workspace packages built successfully.
- Desktop main, sandboxed CJS preload, and renderer built with Vite 8.1.4,
  Rolldown 1.1.5, and electron-vite 6.0.0-beta.1.
- Three Playwright Electron E2E cases passed in 6.1 seconds.

Electron E2E coverage:

| Workflow | Disk assertion | Result |
| --- | --- | --- |
| Create novel, edit, save, then externally modify | Saved content reaches Markdown; stale editor save does not overwrite the external version | Passed |
| Create screenplay and navigate its fixed structure | `第一幕/01-第一场.md` exists and opens in the editor | Passed |
| Preview and import a complex Markdown folder | Preview writes no metadata; confirmation preserves unclassified Markdown and writes valid metadata | Passed |

Focused service and contract coverage includes:

- Chinese, spaces, `#`, and `&` in project names and paths.
- Duplicate project IDs, invalid metadata, traversal, absolute paths, `.git`,
  metadata-file access, and symbolic-link rejection.
- Copy-import staging, nested-destination rejection, and regression coverage proving
  a failed import cannot delete an existing destination.
- Optimistic save conflicts, temporary-file cleanup, file-mode retention, and
  non-blocking save-event publication.

## Visual and package evidence

The writing workspace screenshot at
`apps/desktop/test-results/m2-writing-workspace.png` was inspected at desktop
size. Project navigation, structure tree, editor, save state, and auxiliary tabs
were visible without overlap or clipped controls.

Fresh unsigned local validation artifacts were produced:

| Target | Artifact | Result |
| --- | --- | --- |
| macOS arm64 | `.app`, 116 MB DMG, 116 MB ZIP | Packaged successfully |
| macOS arm64 | Packaged renderer-to-preload-to-main IPC smoke | Passed (`AUTHOR_COPILOT_ELECTRON_SMOKE_READY`) |

`git diff --check` also passed.

## Open exit conditions

M2 is not closed cross-platform until the same workflows run on native Windows
x64 and arm64 environments. In particular, Windows atomic replacement, file
locking, long-path behavior, and matching packaged-app startup still require
real-run evidence. The configured CI matrix is useful packaging coverage but is
not a substitute for those filesystem and launch checks.

No macOS data-loss, path-escape, or stale-write defect is currently known. A
true process-kill fault-injection test between temporary-file fsync and rename is
still desirable; current automated evidence proves staged publication and
cleanup behavior but does not claim deterministic coverage of every crash point.
