# M1 Foundation Validation

- Date: 2026-07-13
- Updated: 2026-08-03
- Scope: M1-01 through M1-04 engineering foundation
- Status: Complete

## Implemented baseline

- pnpm 11.7.0 and Turbo 2.10.4 workspace with one root verification command.
- TypeScript 6.0.3 applications and shared runtime-neutral contracts.
- Electron main, sandboxed preload, and React renderer built by Vite 8.1.4,
  Rolldown 1.1.5, and electron-vite 6.0.0-beta.1.
- Deny-by-default Electron navigation, windows, webviews, permissions, and IPC.
- Strict project metadata schema plus runtime, error, index, and task contracts.
- NestJS 11 health endpoint, validation, security headers, and default-off CORS.
- GitHub Actions quality gate and macOS/Windows x64/arm64 package matrix.

## Validation evidence

The initial `pnpm verify` passed on macOS arm64 with Node 24.16.0:

- Prettier and workspace-boundary checks passed.
- Lint and typecheck passed for all seven workspace packages.
- 28 tests passed: contracts 6, project schema 7, test utilities 2,
  TypeScript config 2, ESLint config 2, Desktop security 7, and API health 1.
- All seven workspace packages built successfully.
- Desktop build used Vite 8.1.4 for main, preload, and renderer. The sandboxed
  preload was emitted as CJS by Rolldown and loaded successfully.

Desktop runtime evidence:

| Target        | Package                 | Packaged IPC smoke       |
| ------------- | ----------------------- | ------------------------ |
| macOS arm64   | ZIP, DMG, `.app`        | Passed locally and in CI |
| macOS x64     | ZIP, DMG, `.app`        | Passed under Rosetta and in native CI |
| Windows x64   | NSIS, unpacked app      | Passed in native CI      |
| Windows arm64 | NSIS, ARM64 unpacked app | Passed in native CI     |

A local Windows x64 cross-package attempt reached the Electron runtime download
but was cancelled after sustained CDN throughput stalled; it produced no
artifact and is not counted as package evidence.

The smoke marker is emitted only after the React renderer invokes the typed
preload API, the main process authorizes the sender and channel, and the runtime
response passes the shared Zod schema. A loaded window alone is not considered
success.

[Desktop package matrix run 30802457876](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30802457876)
passed all four native jobs for commit `da020d2c601cd8dc6a1801d1294cb07e2fb1d860`:
[macOS x64](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30802457876/job/91649977034),
[macOS arm64](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30802457876/job/91649977053),
[Windows x64](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30802457876/job/91649977102), and
[Windows arm64](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30802457876/job/91649977153).
The Windows ARM64 job ran on the `windows-11-arm64` image, launched
`win-arm64-unpacked/Author Copilot.exe`, and received
`AUTHOR_COPILOT_ELECTRON_SMOKE_READY`. The same job also passed Electron SQLite
FTS5, bundled Git runtime, production-service, network-security, packaged-path,
and artifact-upload checks. The smoke step is blocking for every architecture.

[Quality run 30802457850](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30802457850)
passed formatting, workspace boundaries, lint with no errors, typecheck, tests,
builds, and Electron E2E for the same commit.

## Exit gate result

M1-04 is closed. The package workflow now produces and launches macOS x64/arm64
and Windows x64/arm64 artifacts on matching native runners, and a startup failure
on any target fails the matrix. Signing, notarization, and installed-package
smoke remain M8 release-candidate evidence rather than M1 development-package
startup evidence.

`electron-vite@6.0.0-beta.1` is used because stable 5.0.0 does not declare Vite
8 compatibility. The beta remains pinned and may be promoted only after the
four-architecture package and startup matrix passes or a stable Vite 8-capable
release is available. The matrix now passes; changing the pinned beta still
requires a separate dependency qualification rather than an automatic upgrade.
