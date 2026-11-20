# Development

## Prerequisites

工具链固定为 Node.js 24.22.2、pnpm 11.28.11、Python 3.14.10、uv 0.13.7。Node / pnpm 由 Volta 2.0.2 管理；Python 由 uv 管理。TypeScript 6.0.3、Vite 8.3.5、Prettier 3.9.10 通过 workspace catalog 和锁文件管理。

在本机登录环境和 CI 中设置 `VOLTA_FEATURE_PNPM=1`，并确保 Volta 的 bin 目录和 uv 所在目录位于 PATH 前部。

```bash
export VOLTA_FEATURE_PNPM=1
volta install node@24.22.2 pnpm@11.28.11
uv python install --default 3.14.10
pnpm install --frozen-lockfile
```

根目录 `package.json` 是 Node / pnpm 版本来源；子项目通过 `volta.extends` 继承。`.node-version` 与其保持一致。Python 命令通过 `uv run` 执行；`uv.toml` 固定 uv 版本。`--default` 创建受 uv 管理的 `python` / `python3` 入口，需要确保其 bin 目录在 PATH 前部；普通系统 `python3` 不会读取 `.python-version`。更新工具链时同步 catalog、锁文件、CI、容器和本文。历史验证报告保留当时实际使用的版本。

Turbo 固定为 2.11.10。

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
for BYOK. The local entry does not authenticate a managed account. Platform login
is available separately; online payments remain pending. Platform accounts, custom Anthropic providers and
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
idle time, unsaved drafts and persistence failure behavior. The **7-day trend**
entry opens daily signed net counts and their total for this work, including today.
Missing days show zero; unreadable history shows a retry state. See the
[seven-day history guide](reports/2026-09-27-writing-history.md).

Platform package commands:

```bash
pnpm --filter @author-copilot/desktop package:mac:arm64
pnpm --filter @author-copilot/desktop package:mac:x64
pnpm --filter @author-copilot/desktop package:win:arm64
pnpm --filter @author-copilot/desktop package:win:x64
```

## Local work storage, assistants and Skills

The implementation follows [account and work AI workspaces](specs/ai-workspaces-and-skills.md).
Each identity has `userData/accounts/<identity>/workspace` and a private sibling
`runtime`. Anonymous writing uses `local`; signed-in identities use account UUIDs.
Works live in `workspace/projects/<projectId>`. New and imported works use managed
storage without a destination picker; import sources remain unchanged. No legacy
migration is provided.

The home **Account AI assistant** reads this account's catalog and works and keeps
its own conversation history. It can locate a book, recall plots or compare works,
but cannot write. Work assistants use their book folder as cwd and may revise
manuscripts, assets and Skill Markdown through Claude's native tools.

Global and work `.claude/skills` directories contain the applicable Skills.
Frontmatter `author-copilot-scope` is `global`, `work` or `both`. Shared Skills are
projected into a work before its task snapshot, with fingerprints in runtime;
a book's own same-name Skill wins and edited projections become book overrides.
Only the current cwd's project configuration source loads. `CLAUDE_CONFIG_DIR`
points to persistent `runtime/claude`, separate from the creative `.claude` roots.
This avoids ambiguous SDK user/project Skill precedence. Ancestor instructions
are excluded; Main injects only the current workspace's `CLAUDE.md` as text.

Read/Glob/Grep/Write/Edit/Skill are native SDK tools. Main-owned SDK Hooks enforce
paths, protect settings, and record mutations before native writes, then verify
results for review and recovery. Shell, subagents, arbitrary MCP, plugins and
executable Skill hooks remain disabled. Configuration files describe defaults;
callbacks run in Main rather than executing imported hook scripts.

Creative notes, outlines, summaries and facts share the work's canonical
`创作资产/资料.md`. Entry headers retain identity, type, revision and source metadata.
Native edits may revise existing content; evidence changes and new confirmed
facts still use the author's confirmation flow. Derived indexes and task journals
stay in private runtime; credentials stay outside creative workspaces.

Account switching blocks new IPC work, checks unsaved edits, closes book tabs,
cancels and drains tasks and writes, then changes the namespace. A Skill never
grants extra directory access. See [delivery and validation](reports/2026-11-09-ai-workspaces-and-skills.md)
for the actual SDK tests and platform limits.

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

## AI creative note drafts

Open **Creative notes** in the writing workspace and select **AI creative notes**.
Choose an outline, idea expansion or note organization task, describe the request,
and optionally select saved notes and chapters. A current manuscript is not required.
Generation uses the selected AI connection and returns an editable draft without
saving it. Confirm to create a note or update the selected note after reviewing its
diff. Version conflicts preserve the draft and allow saving it as a new note.
See [the delivery record](reports/2026-11-05-ai-creative-notes.md) for limits and validation.

## Chapter summaries

Open **Creative notes → Summarize a chapter**. Select one saved chapter or scene;
the default brief requests key events, character changes, time/place and unresolved
threads. The author can edit the brief and result before confirming a new note or
reviewing an update diff. Only the selected saved document is factual evidence.

Each summary stores its source path, content SHA-256 and capture time. Selecting
a summary, focusing the window or choosing **Check source** compares the current
saved text to this snapshot; changed and missing sources preserve the note.
Regenerate to refresh it, or choose a new source if the document moved. Manual
summary edits retain the original source snapshot. AI reference snapshots carry
the source metadata; check freshness in Creative notes before using them.

See [requirements](specs/chapter-summaries.md) and
[delivery record](reports/2026-11-07-chapter-summaries.md).

## Fact library

Open **Creative notes → Extract facts** and choose one saved chapter or scene.
Selecting an existing summary preselects its source manuscript; extraction uses
current saved manuscript text. Edit each candidate and check its confirmation
before **Save confirmed facts**. Editing clears that candidate's confirmation.
Unselected candidates remain available for review; rejected candidates are discarded.

The **Fact library** filter contains confirmed facts. Author edits retain the
source snapshot; **Check source** and **Open source** support manual review when
manuscripts change. Facts can be explicitly selected in Ask/Agent references.
Re-extraction produces new candidates and does not overwrite existing facts.
Pending candidates live only in memory. Confirmed facts share the work’s creative
asset document and version history; manuscript exports still exclude assets.

See [requirements and boundaries](specs/fact-library.md) and
[delivery record](reports/2026-11-07-fact-library.md).
