# Repository Guidelines

## Project Structure & Module Organization

This repository is a pnpm/Turbo monorepo. Application code lives in `apps/`: `apps/desktop` contains the Electron main, preload, and React renderer processes, while `apps/api` contains the NestJS service. Reusable contracts, project schemas, test helpers, and shared TypeScript/ESLint configuration live in `packages/`. Architecture decisions and requirements belong in `docs/`; experimental work is isolated under `spikes/`. Keep cross-process types in `packages/contracts` rather than duplicating them inside an app.

## Development Status

The project is under active development without compatibility guarantees. Full refactors are allowed when they produce a clearer, safer design. Update affected callers, contracts, tests, and documentation together; do not preserve obsolete APIs solely for compatibility.

## Build, Test, and Development Commands

Use Node.js 24.16+ and pnpm 11.7. Install dependencies with `pnpm install --frozen-lockfile`.

- `pnpm dev`: run workspace development tasks in parallel.
- `pnpm build`: build all packages and applications through Turbo.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`: run repository-wide static checks and unit tests.
- `pnpm test:e2e`: build and run the desktop Playwright flow.
- `pnpm verify`: run formatting, boundary checks, lint, type checking, tests, builds, and E2E validation.
- `pnpm --filter @author-copilot/desktop dev`: run only the Electron app.
- `HOST=127.0.0.1 PORT=9191 pnpm --filter @author-copilot/api dev`: run the API locally.

## Coding Style & Naming Conventions

Write TypeScript with two-space indentation, double quotes, semicolons, and trailing commas as produced by Prettier. Run `pnpm format` only for intentional repository-wide formatting; use `pnpm format:check` for validation. ESLint enforces strict equality and type-only imports. Use PascalCase for React components and exported types, camelCase for functions and variables, and descriptive kebab-case filenames for non-component modules. Preserve Electron's main/preload/renderer separation and expose renderer capabilities only through typed preload IPC.

## Testing Guidelines

Vitest unit tests use `*.test.ts` and live in each workspace's `test/` or `tests/` directory. Desktop E2E tests live in `apps/desktop/e2e/` and use Playwright. Add focused tests beside the affected module's existing suite; there is no fixed coverage threshold. Run the narrow workspace test first, for example `pnpm --filter @author-copilot/desktop test`, then broader checks when appropriate.

## Commit & Pull Request Guidelines

Use Conventional Commits: `feat:`, `fix:`, `docs:`, or `refactor:` followed by a concise imperative summary. Keep commits scoped to one concern. Pull requests should explain the behavior change, list validation performed, link the relevant issue or requirement, and include screenshots for renderer changes. Call out architecture, IPC, security, or configuration impacts explicitly.
