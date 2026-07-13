# M1 Foundation Validation

- Date: 2026-07-13
- Scope: M1-01 through M1-04 engineering foundation
- Status: Implemented; cross-platform exit gate remains open

## Implemented baseline

- pnpm 11.7.0 and Turbo 2.10.4 workspace with one root verification command.
- TypeScript 6.0.3 applications and shared runtime-neutral contracts.
- Electron main, sandboxed preload, and React renderer built by Vite 8.1.4,
  Rolldown 1.1.5, and electron-vite 6.0.0-beta.1.
- Deny-by-default Electron navigation, windows, webviews, permissions, and IPC.
- Strict project metadata schema plus runtime, error, index, and task contracts.
- NestJS 11 health endpoint, validation, security headers, and default-off CORS.
- GitHub Actions quality gate and macOS/Windows x64/arm64 package matrix.

## Local evidence

`pnpm verify` passed on macOS arm64 with Node 24.16.0:

- Prettier and workspace-boundary checks passed.
- Lint and typecheck passed for all seven workspace packages.
- 28 tests passed: contracts 6, project schema 7, test utilities 2,
  TypeScript config 2, ESLint config 2, Desktop security 7, and API health 1.
- All seven workspace packages built successfully.
- Desktop build used Vite 8.1.4 for main, preload, and renderer. The sandboxed
  preload was emitted as CJS by Rolldown and loaded successfully.

Desktop runtime evidence:

| Target | Package | Packaged IPC smoke |
| --- | --- | --- |
| macOS arm64 | ZIP, DMG, `.app` | Passed |
| macOS x64 | ZIP, DMG, `.app` | Passed under Rosetta |
| Windows x64 | CI matrix configured | Not run locally |
| Windows arm64 | CI matrix configured | Packaging and real launch not yet run |

A local Windows x64 cross-package attempt reached the Electron runtime download
but was cancelled after sustained CDN throughput stalled; it produced no
artifact and is not counted as package evidence.

The smoke marker is emitted only after the React renderer invokes the typed
preload API, the main process authorizes the sender and channel, and the runtime
response passes the shared Zod schema. A loaded window alone is not considered
success.

## Open exit conditions

M1 cannot be closed until the package workflow has produced and launched the
Windows x64 and arm64 artifacts on matching runners. Windows arm64 launch is an
explicit non-blocking gap in the initial workflow and must become blocking
before M1 exit.

`electron-vite@6.0.0-beta.1` is used because stable 5.0.0 does not declare Vite
8 compatibility. The beta remains pinned and may be promoted only after the
four-architecture package and startup matrix passes or a stable Vite 8-capable
release is available.
