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
round trip.

Platform package commands:

```bash
pnpm --filter @author-copilot/desktop package:mac:arm64
pnpm --filter @author-copilot/desktop package:mac:x64
pnpm --filter @author-copilot/desktop package:win:arm64
pnpm --filter @author-copilot/desktop package:win:x64
```

## API

```bash
HOST=127.0.0.1 PORT=3000 pnpm --filter @author-copilot/api dev
```

The M1 health endpoint is available at `http://127.0.0.1:3000/health`.
MongoDB and Redis are intentionally deferred to M7.
