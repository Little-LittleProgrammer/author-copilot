import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createHttpsRemoteEnvironment,
  createSshRemoteEnvironment,
} from "../src/main/git/remote-environment.js";
import type { RemoteEnvironmentError } from "../src/main/git/remote-environment.js";

describe("remote Git environment", () => {
  it("pins HTTPS credentials and the enterprise CA to a verified origin", () => {
    const enterpriseCaPath = resolve("fixture", "enterprise-ca.pem");
    const environment = createHttpsRemoteEnvironment({
      remoteUrl: "https://git.example.com/team/repository.git",
      enterpriseCaPath,
      credential: {
        origin: "https://git.example.com",
        username: "writer",
        secret: "credential-secret",
      },
    });

    expect(environment.GIT_SSL_CAINFO).toBe(enterpriseCaPath);
    expect(environment).not.toHaveProperty("GIT_SSL_NO_VERIFY");
    const entries = gitConfigEntries(environment);
    expect(entries).toMatchObject({
      "credential.helper": "",
      "http.https://git.example.com/.followRedirects": "false",
      "http.https://git.example.com/.sslCAInfo": enterpriseCaPath,
      "http.https://git.example.com/.sslVerify": "true",
    });
    expect(entries["http.https://git.example.com/.extraHeader"]).toBe(
      `Authorization: Basic ${Buffer.from("writer:credential-secret").toString(
        "base64",
      )}`,
    );
    expect(entries["http.sslBackend"]).toBe(
      process.platform === "win32" ? "openssl" : undefined,
    );
  });

  it("rejects embedded or cross-origin HTTPS credentials", () => {
    const enterpriseCaPath = resolve("fixture", "enterprise-ca.pem");
    expect(() =>
      createHttpsRemoteEnvironment({
        remoteUrl: "https://writer:secret@git.example.com/repository.git",
        enterpriseCaPath,
      }),
    ).toThrow(
      expect.objectContaining<Partial<RemoteEnvironmentError>>({
        code: "invalid_remote",
      }),
    );
    expect(() =>
      createHttpsRemoteEnvironment({
        remoteUrl: "https://git.example.com/repository.git",
        enterpriseCaPath,
        credential: {
          origin: "https://other.example.com",
          username: "writer",
          secret: "secret",
        },
      }),
    ).toThrow(
      expect.objectContaining<Partial<RemoteEnvironmentError>>({
        code: "credential_mismatch",
      }),
    );
  });

  it("accepts only strict SSH URLs and absolute tool paths", () => {
    const sshExecutable = resolve("fixture", "ssh");
    const sshConfigPath = resolve("fixture", "ssh-config");
    const portableSshExecutable = portablePath(sshExecutable);
    const portableSshConfigPath = portablePath(sshConfigPath);
    expect(
      createSshRemoteEnvironment({
        remoteUrl: "ssh://git@git.example.com/repository.git",
        sshExecutable,
        sshConfigPath,
      }),
    ).toEqual({
      GIT_SSH_COMMAND: `'${portableSshExecutable}' -F '${portableSshConfigPath}'`,
      GIT_SSH_VARIANT: "ssh",
      GIT_TERMINAL_PROMPT: "0",
    });
    expect(() =>
      createSshRemoteEnvironment({
        remoteUrl: "git@git.example.com:repository.git",
        sshExecutable,
        sshConfigPath,
      }),
    ).toThrow(
      expect.objectContaining<Partial<RemoteEnvironmentError>>({
        code: "invalid_remote",
      }),
    );
  });
});

function portablePath(value: string): string {
  return process.platform === "win32" ? value.replaceAll("\\", "/") : value;
}

function gitConfigEntries(
  environment: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const count = Number(environment.GIT_CONFIG_COUNT);
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      environment[`GIT_CONFIG_KEY_${index}`],
      environment[`GIT_CONFIG_VALUE_${index}`],
    ]),
  );
}
