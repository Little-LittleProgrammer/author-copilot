import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  parseManifest,
  runtimeMetadata,
  selectTarget,
  sha256File,
  validateArchiveEntries,
  verifyRuntime,
} from "./git-runtime-lib.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

function source(fileName = "runtime.zip") {
  return {
    fileName,
    url: `https://example.test/${fileName}`,
    sha256: "a".repeat(64),
  };
}

function target(platform, arch) {
  return {
    platform,
    arch,
    version: "1.2.3",
    distribution: "archive",
    archive: source(`${platform}-${arch}.zip`),
    executable: platform === "win32" ? "cmd/git.exe" : "bin/git",
    execPath: "libexec/git-core",
    templateDir: "share/git-core/templates",
    caBundlePath: "etc/ssl/certs/ca-bundle.crt",
    requiredPaths: [
      { path: platform === "win32" ? "cmd/git.exe" : "bin/git", type: "file" },
      { path: "libexec/git-core", type: "directory" },
    ],
  };
}

function manifestInput() {
  return {
    schemaVersion: 1,
    metadataFile: "author-copilot-git-runtime.json",
    targets: {
      "darwin-arm64": target("darwin", "arm64"),
      "darwin-x64": target("darwin", "x64"),
      "win32-arm64": target("win32", "arm64"),
      "win32-x64": target("win32", "x64"),
    },
  };
}

test("parses all supported runtime targets and selects one exactly", () => {
  const manifest = parseManifest(manifestInput());
  const selected = selectTarget(manifest, "win32", "arm64");
  assert.equal(selected.key, "win32-arm64");
  assert.equal(selected.target.executable, "cmd/git.exe");
  assert.throws(
    () => selectTarget(manifest, "linux", "x64"),
    /No Git runtime is configured/u,
  );
});

test("rejects manifest paths and archive entries that escape their roots", () => {
  const input = manifestInput();
  input.targets["darwin-arm64"].executable = "../git";
  assert.throws(() => parseManifest(input), /must stay inside/u);
  assert.throws(
    () => validateArchiveEntries(["safe/file", "../../outside"]),
    /escapes the extraction directory/u,
  );
  assert.throws(
    () => validateArchiveEntries(["C:\\outside\\git.exe"]),
    /escapes the extraction directory/u,
  );
});

test("hashes files and verifies runtime metadata and required path types", async () => {
  const root = await mkdtemp(join(tmpdir(), "git-runtime-lib-"));
  temporaryRoots.push(root);
  const file = join(root, "payload");
  await writeFile(file, "author-copilot", "utf8");
  assert.equal(
    await sha256File(file),
    "59a257e48d6d0a89dcc3da3b9781a844486a5de8d2b90ba377f2bbae6eb7cfe9",
  );

  const manifest = parseManifest(manifestInput());
  const { key, target: selectedTarget } = selectTarget(
    manifest,
    "darwin",
    "arm64",
  );
  await mkdir(join(root, "bin"));
  await mkdir(join(root, "libexec", "git-core"), { recursive: true });
  await writeFile(join(root, "bin", "git"), "binary", "utf8");
  await writeFile(
    join(root, manifest.metadataFile),
    JSON.stringify(runtimeMetadata(manifest, key, selectedTarget)),
    "utf8",
  );
  await assert.doesNotReject(
    verifyRuntime(root, manifest, key, selectedTarget),
  );
  await writeFile(join(root, manifest.metadataFile), "{}", "utf8");
  await assert.rejects(
    verifyRuntime(root, manifest, key, selectedTarget),
    /metadata does not match/u,
  );
});
