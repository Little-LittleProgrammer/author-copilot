import { isAbsolute } from "node:path";

import { normalizeHttpsOrigin } from "../credentials/secure-credential-store.js";
import type { HttpsCredential } from "../credentials/secure-credential-store.js";

export type RemoteEnvironmentErrorCode =
  "credential_mismatch" | "invalid_path" | "invalid_remote";

export class RemoteEnvironmentError extends Error {
  public constructor(
    public readonly code: RemoteEnvironmentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RemoteEnvironmentError";
  }
}

interface HttpsRemoteEnvironmentOptions {
  readonly remoteUrl: string;
  readonly enterpriseCaPath: string;
  readonly credential?: HttpsCredential;
}

interface SshRemoteEnvironmentOptions {
  readonly remoteUrl: string;
  readonly sshExecutable: string;
  readonly sshConfigPath: string;
}

function parseRemoteUrl(value: string, protocol: "https:" | "ssh:"): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RemoteEnvironmentError(
      "invalid_remote",
      "The remote URL is invalid.",
    );
  }
  if (
    url.protocol !== protocol ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    url.hostname.length === 0
  ) {
    throw new RemoteEnvironmentError(
      "invalid_remote",
      `Only credential-free ${protocol.slice(0, -1).toUpperCase()} URLs are supported.`,
    );
  }
  if (protocol === "https:" && url.username.length > 0) {
    throw new RemoteEnvironmentError(
      "invalid_remote",
      "HTTPS credentials must not be embedded in the remote URL.",
    );
  }
  return url;
}

function assertAbsoluteSafePath(value: string, name: string): void {
  if (
    !isAbsolute(value) ||
    value.includes("\0") ||
    value.includes("\r") ||
    value.includes("\n")
  ) {
    throw new RemoteEnvironmentError(
      "invalid_path",
      `The ${name} path is invalid.`,
    );
  }
}

function gitConfigEnvironment(
  entries: readonly (readonly [string, string])[],
): Readonly<Record<string, string>> {
  return Object.fromEntries([
    ["GIT_CONFIG_COUNT", String(entries.length)],
    ...entries.flatMap(([key, value], index) => [
      [`GIT_CONFIG_KEY_${index}`, key] as const,
      [`GIT_CONFIG_VALUE_${index}`, value] as const,
    ]),
  ]);
}

function quoteForGitShell(value: string): string {
  const portable =
    process.platform === "win32" ? value.replaceAll("\\", "/") : value;
  return `'${portable.replaceAll("'", `'\\''`)}'`;
}

export function createHttpsRemoteEnvironment(
  options: HttpsRemoteEnvironmentOptions,
): Readonly<Record<string, string>> {
  const remote = parseRemoteUrl(options.remoteUrl, "https:");
  assertAbsoluteSafePath(options.enterpriseCaPath, "enterprise CA");
  const origin = normalizeHttpsOrigin(remote.origin);
  if (
    options.credential !== undefined &&
    normalizeHttpsOrigin(options.credential.origin) !== origin
  ) {
    throw new RemoteEnvironmentError(
      "credential_mismatch",
      "The HTTPS credential does not match the remote origin.",
    );
  }
  const scope = `http.${origin}/`;
  const entries: Array<readonly [string, string]> = [
    ["credential.helper", ""],
    [`${scope}.sslCAInfo`, options.enterpriseCaPath],
    [`${scope}.sslVerify`, "true"],
    [`${scope}.followRedirects`, "false"],
  ];
  if (process.platform === "win32") {
    entries.push(["http.sslBackend", "openssl"]);
  }
  if (options.credential !== undefined) {
    const basic = Buffer.from(
      `${options.credential.username}:${options.credential.secret}`,
      "utf8",
    ).toString("base64");
    entries.push([`${scope}.extraHeader`, `Authorization: Basic ${basic}`]);
  }
  return {
    ...gitConfigEnvironment(entries),
    GCM_INTERACTIVE: "Never",
    GIT_SSL_CAINFO: options.enterpriseCaPath,
    GIT_TERMINAL_PROMPT: "0",
  };
}

export function createSshRemoteEnvironment(
  options: SshRemoteEnvironmentOptions,
): Readonly<Record<string, string>> {
  parseRemoteUrl(options.remoteUrl, "ssh:");
  assertAbsoluteSafePath(options.sshExecutable, "SSH executable");
  assertAbsoluteSafePath(options.sshConfigPath, "SSH configuration");
  return {
    GIT_SSH_COMMAND: `${quoteForGitShell(options.sshExecutable)} -F ${quoteForGitShell(options.sshConfigPath)}`,
    GIT_SSH_VARIANT: "ssh",
    GIT_TERMINAL_PROMPT: "0",
  };
}
