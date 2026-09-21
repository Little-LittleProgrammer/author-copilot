# Claude SDK Electron spike

This M0 spike verifies the locked SDKs inside a security-hardened Electron main
process without sending requests to Anthropic:

- `@anthropic-ai/sdk@0.111.0`: local mock streaming, cancellation, and timeout.
- `@anthropic-ai/claude-agent-sdk@0.3.207`: package import, explicit denial of
  built-in filesystem/Shell/Web/child-agent tools, and the names reserved for
  application-owned file tools.
- Electron: `contextIsolation: true`, `nodeIntegration: false`, renderer sandbox,
  strict CSP, ASAR packaging, and a hidden smoke window.

## Run

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm smoke:electron
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm package:mac:arm64
```

The tests use only a loopback HTTP server and a synthetic API key. They do not
read credentials or call an external model.

`electron-builder@26.15.3` declares `@electron/get@^3.0.0`, but its packaging
code requires the cache-mode export added in `3.1.0`. The local pnpm override
keeps the transitive dependency on `3.1.0`; removing it reproduces a
`CacheMode.ReadWrite` packaging failure.

Current macOS arm64 evidence is recorded in
[`reports/macos-arm64-smoke.json`](reports/macos-arm64-smoke.json). The package
is intentionally unsigned because M0 signing credentials are not yet available.

## Evidence boundary

Passing on one machine proves only the current platform and architecture. M0-03
remains open until packaged applications on macOS x64/arm64 and Windows
x64/arm64 can all:

1. load both SDKs;
2. stream and cancel a request through the approved mock/proxy contract;
3. start and cancel an Agent SDK task;
4. terminate the complete child-process tree; and
5. demonstrate that project-bound policy rejects paths and tools outside the
   single-task capability.

Native Windows has no Claude OS sandbox in the MVP contract. The production
Agent must deny built-in filesystem, Shell, PowerShell, Web, arbitrary MCP, and
child-agent tools. The `mcp__author_copilot__*` names in this spike are a policy
contract, not implemented tools: M1/M6 must bind them to application-owned
handlers that enforce real-path authorization and the mutation ledger in the
Electron main process.
