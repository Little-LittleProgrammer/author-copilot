# Author Copilot Desktop

M1 provides the secure Electron application shell. It intentionally exposes only
the typed `system.getRuntimeInfo` preload capability and does not contain writing
or AI workflows.

## Build stack

The desktop build uses Rolldown through Vite 8. `electron-vite@6.0.0-beta.1` is
pinned because it is the first selected electron-vite line whose peer contract
supports Vite 8. This beta is an explicit M1 integration risk: upgrades require
rerunning build, security tests, Electron smoke, and all four packaging jobs.

## Commands

- `pnpm build` builds main, preload, and renderer.
- `pnpm test` runs the Electron security policy tests.
- `pnpm smoke` builds and starts Electron until the renderer readiness marker.
- `node scripts/electron-smoke.ts --executable <path>` starts a packaged app
  executable and waits for the same readiness marker.
- `pnpm package` creates the configured packages for the current host.
- `pnpm package:mac:x64` and `pnpm package:mac:arm64` build macOS development apps.
- `pnpm package:win:x64` and `pnpm package:win:arm64` build Windows development apps.

The architecture commands describe the required matrix; they do not constitute
verification by existing on disk. Each artifact must be started and smoke-tested
on its matching real macOS or Windows architecture before the M1 exit gate closes.
