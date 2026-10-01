import { IPC_INVOKE_CHANNELS } from "@author-copilot/contracts";
import { describe, expect, it } from "vitest";

import { assertTrustedIpcRequest } from "../src/main/ipc-policy.js";
import { PRODUCTION_CSP } from "../src/main/security-policy.js";
import { createWindowOptions } from "../src/main/window-options.js";

const trustedRendererUrl = "file:///application/out/renderer/index.html";

function trustedRequest(overrides = {}) {
  return {
    channel: IPC_INVOKE_CHANNELS.runtimeGetInfo,
    senderFrameUrl: trustedRendererUrl,
    mainFrameUrl: trustedRendererUrl,
    trustedRendererUrl,
    isMainFrame: true,
    args: [],
    ...overrides,
  };
}

describe("Electron security baseline", () => {
  it("enforces an isolated and sandboxed renderer", () => {
    const options = createWindowOptions("/application/preload/index.js");

    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      navigateOnDragDrop: false,
    });
  });

  it("uses a production CSP without eval permissions", () => {
    expect(PRODUCTION_CSP).toContain("default-src 'self'");
    expect(PRODUCTION_CSP).toContain("object-src 'none'");
    expect(PRODUCTION_CSP).not.toContain("unsafe-eval");
  });
});

describe("IPC authorization", () => {
  it("allows the named runtime capability from the trusted top frame", () => {
    expect(() => assertTrustedIpcRequest(trustedRequest())).not.toThrow();
  });

  it("rejects non-whitelisted channels", () => {
    expect(() =>
      assertTrustedIpcRequest(trustedRequest({ channel: "system:exec" })),
    ).toThrow("IPC channel is not allowed");
  });

  it("rejects an untrusted sender URL", () => {
    expect(() =>
      assertTrustedIpcRequest(
        trustedRequest({
          senderFrameUrl: "https://attacker.invalid/index.html",
          mainFrameUrl: "https://attacker.invalid/index.html",
        }),
      ),
    ).toThrow("IPC sender is not trusted");
  });

  it("rejects subframes", () => {
    expect(() =>
      assertTrustedIpcRequest(trustedRequest({ isMainFrame: false })),
    ).toThrow("IPC sender is not trusted");
  });

  it("rejects unexpected arguments", () => {
    expect(() =>
      assertTrustedIpcRequest(
        trustedRequest({ args: [{ command: "whoami" }] }),
      ),
    ).toThrow("IPC request does not accept arguments");
  });

  it("requires exactly one argument for project operations", () => {
    expect(() =>
      assertTrustedIpcRequest(
        trustedRequest({
          channel: IPC_INVOKE_CHANNELS.projectList,
          args: [{}],
          expectedArgumentCount: 1,
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertTrustedIpcRequest(
        trustedRequest({
          channel: IPC_INVOKE_CHANNELS.projectList,
          args: [],
          expectedArgumentCount: 1,
        }),
      ),
    ).toThrow("IPC request has an invalid argument count");
  });
});
