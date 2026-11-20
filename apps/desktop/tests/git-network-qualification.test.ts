import { execFile, spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { generate } from "selfsigned";
import { Server as SshServer, utils as sshUtils } from "ssh2";
import type { AuthContext, Connection, ParsedKey, ServerChannel } from "ssh2";
import { afterEach, describe, expect, it } from "vitest";

import { SecureCredentialStore } from "../src/main/credentials/secure-credential-store.js";
import type { CredentialEncryption } from "../src/main/credentials/secure-credential-store.js";
import {
  createHttpsRemoteEnvironment,
  createSshRemoteEnvironment,
} from "../src/main/git/remote-environment.js";
import { resolveGitRuntime } from "../src/main/git-runtime.js";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];
const resourcesPath =
  process.env.AUTHOR_COPILOT_TEST_GIT_RESOURCES_PATH?.trim();
const gitRuntime = resolveGitRuntime({
  arch: process.arch,
  isPackaged: resourcesPath !== undefined && resourcesPath.length > 0,
  platform: process.platform,
  resourcesPath: resourcesPath || process.cwd(),
});
const baseGitEnvironment = {
  ...process.env,
  ...gitRuntime.environment,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};
const testEncryption: CredentialEncryption = {
  isAvailable: () => true,
  encrypt: (plaintext) =>
    Buffer.from(`encrypted:${Buffer.from(plaintext).toString("base64")}`),
  decrypt: (ciphertext) => {
    const encoded = ciphertext.toString("utf8").replace(/^encrypted:/u, "");
    return Buffer.from(encoded, "base64").toString("utf8");
  },
};

interface GitFixture {
  readonly bareRepository: string;
  readonly root: string;
}

function sameBuffer(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function isInside(parent: string, child: string): boolean {
  const result = relative(parent, child);
  return (
    result !== "" &&
    result !== ".." &&
    !result.startsWith(`..${sep}`) &&
    !isAbsolute(result)
  );
}

function portableSshPath(value: string): string {
  return process.platform === "win32" ? value.replaceAll("\\", "/") : value;
}

function generateParseableEd25519KeyPair() {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const keyPair = sshUtils.generateKeyPairSync("ed25519");
    const privateKey = sshUtils.parseKey(keyPair.private);
    const publicKey = sshUtils.parseKey(keyPair.public);
    if (!(privateKey instanceof Error) && !(publicKey instanceof Error)) {
      return keyPair;
    }
  }

  throw new Error("ssh2 repeatedly generated malformed ed25519 test keys.");
}

async function git(
  cwd: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>> = {},
): Promise<{ readonly stderr: string; readonly stdout: string }> {
  const result = await execFileAsync(
    gitRuntime.executable,
    ["-C", cwd, ...args],
    {
      encoding: "utf8",
      env: { ...baseGitEnvironment, ...environment },
      maxBuffer: 1024 * 1024,
      timeout: 20_000,
      windowsHide: true,
    },
  );
  return { stderr: result.stderr, stdout: result.stdout };
}

async function createGitFixture(): Promise<GitFixture> {
  const temporary = await mkdtemp(
    join(tmpdir(), "author-copilot-network-qualification-"),
  );
  temporaryRoots.push(temporary);
  const root = join(temporary, "network fixture 中文");
  const source = join(root, "source");
  const bareRepository = join(root, "repo.git");
  await mkdir(source, { recursive: true });
  await git(root, ["init", "--bare", bareRepository]);
  await git(root, ["init", "--initial-branch=main", source]);
  await writeFile(join(source, "第一章.md"), "network qualification\n", "utf8");
  await git(source, ["add", "--all"]);
  await git(source, [
    "-c",
    "user.name=Author Copilot Test",
    "-c",
    "user.email=test@author-copilot.invalid",
    "commit",
    "-m",
    "fixture",
  ]);
  await git(source, ["remote", "add", "origin", bareRepository]);
  await git(source, ["push", "origin", "main"]);
  await git(root, [
    `--git-dir=${bareRepository}`,
    "symbolic-ref",
    "HEAD",
    "refs/heads/main",
  ]);
  await git(root, [`--git-dir=${bareRepository}`, "update-server-info"]);
  return { bareRepository, root };
}

async function listen(server: {
  address(): AddressInfo | string | null;
  listen(port: number, host: string, callback: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
}): Promise<number> {
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The fixture server did not expose a TCP port.");
  }
  return address.port;
}

async function close(server: {
  close(callback: (error?: Error) => void): void;
}): Promise<void> {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) =>
      error === undefined ? resolveClose() : reject(error),
    );
  });
}

async function assertCloneContents(destination: string): Promise<void> {
  await expect(readFile(join(destination, "第一章.md"), "utf8")).resolves.toBe(
    "network qualification\n",
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("bundled Git network qualification", () => {
  it("requires the explicit enterprise CA and exact HTTPS credential", async () => {
    const fixture = await createGitFixture();
    const ca = await generate(
      [{ name: "commonName", value: "Author Copilot Fixture CA" }],
      {
        algorithm: "sha256",
        extensions: [
          { name: "basicConstraints", cA: true, critical: true },
          {
            name: "keyUsage",
            keyCertSign: true,
            cRLSign: true,
            critical: true,
          },
        ],
      },
    );
    const certificate = await generate(
      [{ name: "commonName", value: "127.0.0.1" }],
      {
        algorithm: "sha256",
        ca: { key: ca.private, cert: ca.cert },
        extensions: [
          { name: "basicConstraints", cA: false },
          {
            name: "keyUsage",
            digitalSignature: true,
            keyEncipherment: true,
            critical: true,
          },
          { name: "extKeyUsage", serverAuth: true },
          { name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] },
        ],
      },
    );
    const expectedAuthorization = `Basic ${Buffer.from("writer:fixture-secret").toString("base64")}`;
    const server = createHttpsServer(
      { cert: certificate.cert, key: certificate.private },
      async (request, response) => {
        if (request.headers.authorization !== expectedAuthorization) {
          response.writeHead(401, {
            "WWW-Authenticate": 'Basic realm="fixture"',
          });
          response.end("Authentication required.");
          return;
        }
        try {
          const requestUrl = new URL(request.url ?? "/", "https://127.0.0.1");
          const candidate = resolve(
            fixture.root,
            `.${decodeURIComponent(requestUrl.pathname)}`,
          );
          if (!isInside(fixture.root, candidate)) {
            response.writeHead(404).end();
            return;
          }
          const entry = await lstat(candidate);
          if (!entry.isFile() || entry.isSymbolicLink()) {
            response.writeHead(404).end();
            return;
          }
          response.writeHead(200, {
            "Content-Type": "application/octet-stream",
          });
          createReadStream(candidate).pipe(response);
        } catch {
          response.writeHead(404).end();
        }
      },
    );
    const port = await listen(server);
    const origin = `https://127.0.0.1:${port}`;
    const remoteUrl = `${origin}/repo.git`;
    const caPath = join(fixture.root, "enterprise-ca.pem");
    const wrongCaPath = join(fixture.root, "wrong-enterprise-ca.pem");
    await writeFile(caPath, ca.cert, { mode: 0o600 });
    const wrongCa = await generate([
      { name: "commonName", value: "Wrong Fixture CA" },
    ]);
    await writeFile(wrongCaPath, wrongCa.cert, { mode: 0o600 });
    const credentialFile = join(fixture.root, "credentials", "store.json");
    const store = new SecureCredentialStore({
      filePath: credentialFile,
      encryption: testEncryption,
    });
    await store.setHttpsCredential({
      origin,
      username: "writer",
      secret: "fixture-secret",
    });
    const credential = await store.getHttpsCredential(origin);
    if (credential === null) throw new Error("Expected an HTTPS credential.");

    try {
      await expect(
        git(
          fixture.root,
          ["clone", remoteUrl, join(fixture.root, "wrong-ca")],
          createHttpsRemoteEnvironment({
            remoteUrl,
            enterpriseCaPath: wrongCaPath,
            credential,
          }),
        ),
      ).rejects.toThrow();
      await expect(
        git(
          fixture.root,
          ["clone", remoteUrl, join(fixture.root, "wrong-credential")],
          createHttpsRemoteEnvironment({
            remoteUrl,
            enterpriseCaPath: caPath,
            credential: { ...credential, secret: "wrong-secret" },
          }),
        ),
      ).rejects.toThrow();
      const destination = join(fixture.root, "https clone 中文");
      const environment = createHttpsRemoteEnvironment({
        remoteUrl,
        enterpriseCaPath: caPath,
        credential,
      });
      expect(environment).not.toHaveProperty("GIT_SSL_NO_VERIFY");
      expect(remoteUrl).not.toContain(credential.secret);
      await git(fixture.root, ["clone", remoteUrl, destination], environment);
      await assertCloneContents(destination);
      expect(await readFile(credentialFile, "utf8")).not.toContain(
        credential.secret,
      );
    } finally {
      await close(server);
    }
  }, 30_000);

  it("requires the confirmed SSH host key and explicitly authorized private key", async () => {
    const fixture = await createGitFixture();
    const hostKey = generateParseableEd25519KeyPair();
    const wrongHostKey = generateParseableEd25519KeyPair();
    const clientKey = generateParseableEd25519KeyPair();
    const wrongClientKey = generateParseableEd25519KeyPair();
    const parsedClientKey = sshUtils.parseKey(clientKey.public);
    if (parsedClientKey instanceof Error) throw parsedClientKey;
    const connections = new Set<Connection>();
    const server = new SshServer(
      { hostKeys: [hostKey.private] },
      (connection) => {
        connections.add(connection);
        connection
          .on("error", () => undefined)
          .on("authentication", (context) =>
            authenticatePublicKey(context, parsedClientKey),
          )
          .on("ready", () => {
            connection.on("session", (acceptSession) => {
              const session = acceptSession();
              session.once("exec", (accept, reject, info) => {
                if (
                  !/^git-upload-pack ['"]\/?repo\.git['"]$/u.test(info.command)
                ) {
                  reject();
                  return;
                }
                serveUploadPack(accept(), fixture.bareRepository);
              });
            });
          })
          .on("close", () => connections.delete(connection));
      },
    );
    const port = await listen(server);
    const remoteUrl = `ssh://git@127.0.0.1:${port}/repo.git`;
    const sshDirectory = join(fixture.root, "ssh config 中文");
    await mkdir(sshDirectory, { recursive: true, mode: 0o700 });
    const privateKeyPath = join(sshDirectory, "authorized-key");
    const wrongPrivateKeyPath = join(sshDirectory, "wrong-key");
    const knownHostsPath = join(sshDirectory, "known_hosts");
    const sshConfigPath = join(sshDirectory, "config");
    await writeFile(privateKeyPath, clientKey.private, { mode: 0o600 });
    await writeFile(wrongPrivateKeyPath, wrongClientKey.private, {
      mode: 0o600,
    });
    await chmod(privateKeyPath, 0o600);
    await chmod(wrongPrivateKeyPath, 0o600);
    const sshExecutable =
      process.platform === "win32"
        ? join(resourcesPath ?? "", "git", "usr", "bin", "ssh.exe")
        : "/usr/bin/ssh";
    const writeSshConfig = async (identityFile: string): Promise<void> => {
      await writeFile(
        sshConfigPath,
        [
          "Host *",
          "  HostName 127.0.0.1",
          `  Port ${port}`,
          "  User git",
          `  IdentityFile \"${portableSshPath(identityFile)}\"`,
          "  IdentitiesOnly yes",
          `  UserKnownHostsFile \"${portableSshPath(knownHostsPath)}\"`,
          "  GlobalKnownHostsFile none",
          "  StrictHostKeyChecking yes",
          "  BatchMode yes",
          "  PasswordAuthentication no",
          "  KbdInteractiveAuthentication no",
          "  PubkeyAuthentication yes",
          "",
        ].join("\n"),
        { mode: 0o600 },
      );
    };
    const knownHostPrefix = `[127.0.0.1]:${port}`;
    const sshEnvironment = (): Readonly<Record<string, string>> =>
      createSshRemoteEnvironment({ remoteUrl, sshExecutable, sshConfigPath });

    try {
      await writeSshConfig(privateKeyPath);
      await writeFile(
        knownHostsPath,
        `${knownHostPrefix} ${publicKeyWithoutComment(wrongHostKey.public)}\n`,
        { mode: 0o600 },
      );
      await expect(
        git(
          fixture.root,
          ["clone", remoteUrl, join(fixture.root, "wrong-host")],
          sshEnvironment(),
        ),
      ).rejects.toThrow();

      await writeFile(
        knownHostsPath,
        `${knownHostPrefix} ${publicKeyWithoutComment(hostKey.public)}\n`,
        { mode: 0o600 },
      );
      await writeSshConfig(wrongPrivateKeyPath);
      await expect(
        git(
          fixture.root,
          ["clone", remoteUrl, join(fixture.root, "wrong-key-clone")],
          sshEnvironment(),
        ),
      ).rejects.toThrow();

      await writeSshConfig(privateKeyPath);
      const destination = join(fixture.root, "ssh clone 中文");
      await git(
        fixture.root,
        ["clone", remoteUrl, destination],
        sshEnvironment(),
      );
      await assertCloneContents(destination);
    } finally {
      for (const connection of connections) connection.end();
      await close(server);
    }
  }, 30_000);
});

function authenticatePublicKey(
  context: AuthContext,
  allowedKey: ParsedKey,
): void {
  if (context.method !== "publickey") {
    context.reject();
    return;
  }
  if (
    context.key.algo !== allowedKey.type ||
    !sameBuffer(context.key.data, allowedKey.getPublicSSH()) ||
    (context.signature !== undefined &&
      (context.blob === undefined ||
        allowedKey.verify(context.blob, context.signature, context.hashAlgo) !==
          true))
  ) {
    context.reject();
    return;
  }
  context.accept();
}

function publicKeyWithoutComment(publicKey: string): string {
  return publicKey.trim().split(/\s+/u).slice(0, 2).join(" ");
}

function serveUploadPack(stream: ServerChannel, bareRepository: string): void {
  const child = spawn(gitRuntime.executable, ["upload-pack", bareRepository], {
    env: baseGitEnvironment,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  stream.pipe(child.stdin);
  child.stdout.pipe(stream, { end: false });
  child.stderr.pipe(stream.stderr);
  child.once("error", (error) => {
    stream.stderr.write(error.message);
    stream.exit(1);
    stream.end();
  });
  child.once("close", (code) => {
    stream.exit(code ?? 1);
    stream.end();
  });
}
