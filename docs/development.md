# Development

## Prerequisites

- Node.js 24.16.0
- pnpm 11.7.0

## Workspace

```bash
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` checks formatting, workspace boundaries, lint, type safety, tests,
and production builds for every workspace package.

## Desktop

```bash
pnpm --filter @author-copilot/desktop dev
pnpm --filter @author-copilot/desktop smoke
pnpm --filter @author-copilot/desktop test:e2e
```

The Desktop build uses TypeScript, Vite 8, Rolldown, React, and electron-vite.
The smoke test succeeds only after the renderer completes a typed preload IPC
round trip and the application exits successfully. Sandboxed preload dependencies
must be bundled; only Electron's supported preload modules may remain external.

The desktop currently opens a local workspace without a business account. Use
**Continue without an account**, then configure an Anthropic API Key in AI settings
for BYOK. This entry does not authenticate a managed account; managed login and
online payments remain pending. Platform accounts, custom Anthropic providers and
the metered relay are described in [the M7 setup guide](reports/2026-09-13-provider-platform-relay.md).

The September review fixes and their verification boundaries are recorded in
[the review follow-up](reports/2026-09-12-review-fixes.md).

M6 now provides one-task BYOK Agent authorization, progress, cancellation, review,
keep/result versions and recovery in the AI workspace. Result versions use
application-owned Git refs and preserve the user's branch and staging area.
See [M6 implementation and validation](reports/m6/2026-09-12-agent-desktop-workflow.md)
for the workflow, process watchdog and remaining platform qualification.

The writing toolbar opens AI chat in a persistent right dock alongside the
manuscript. Chat, Agent tasks and Knowledge have separate dock views; closing the
dock or opening another document preserves its current session and draft.
History opens saved versions and recovery in a dialog. Pending AI suggestions
have their own review entry in the dock.

Font family, size and line spacing are local display preferences. Undo/redo,
literal case-sensitive find/replace and prose formatting edit the current buffer;
save persists it to disk. Formatting indents prose and separates paragraphs while
preserving Markdown blocks, and is undoable. Keyboard shortcuts: Cmd/Ctrl+Z,
Cmd/Ctrl+Shift+Z (or Ctrl+Y), Cmd/Ctrl+F/H and Cmd/Ctrl+S.

The editor footer shows today's net manual character activity for the current
work and an estimated typing rate. Activity is stored locally by Main and survives
restarts; IME preedit, AI edits and document reloads are excluded. See the
[writing statistics guide](reports/2026-09-19-writing-statistics.md) for counting,
idle time, unsaved drafts and persistence failure behavior.

Platform package commands:

```bash
pnpm --filter @author-copilot/desktop package:mac:arm64
pnpm --filter @author-copilot/desktop package:mac:x64
pnpm --filter @author-copilot/desktop package:win:arm64
pnpm --filter @author-copilot/desktop package:win:x64
```

## API

```bash
HOST=127.0.0.1 PORT=9191 pnpm --filter @author-copilot/api dev
```

The M1 health endpoint is available at `http://127.0.0.1:9191/health`.
Platform services use MongoDB transactions and Redis rate limits. See the M7 setup
guide above for environment variables and development-only test credit.

## Bundled Git runtime

The desktop package commands prepare the matching Git runtime automatically.
For local runtime work, use:

```bash
pnpm git-runtime:fetch
pnpm git-runtime:verify
```

The source URLs and SHA-256 values are fixed in
`tooling/git-runtime-manifest.json`. Windows targets use the official Git for
Windows MinGit archives. macOS targets build the official kernel.org Git source
on the matching architecture with a macOS 12.0 deployment target. Generated
runtime files live under `apps/desktop/resources/git` and are not committed.
