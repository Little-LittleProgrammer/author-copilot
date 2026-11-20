import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const MANIFEST_FILE = "snapshot.json";

function runGit(repoRoot, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: null,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
    },
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (!allowFailure && result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${result.status}): ${result.stderr.toString("utf8")}`,
    );
  }
  return result;
}

function splitNul(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== "..")
  );
}

async function assertExternalSnapshot(repoRoot, snapshotDir) {
  const resolvedSnapshot = path.resolve(snapshotDir);
  if (isInside(repoRoot, resolvedSnapshot)) {
    throw new Error("Snapshot storage must be outside the project repository");
  }
}

async function resolveAuthorizedPath(repoRoot, relativePath) {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath)
  ) {
    throw new Error(`Path must be project-relative: ${relativePath}`);
  }

  const normalized = relativePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === ".." || segment === "")) {
    throw new Error(`Path escapes or is not normalized: ${relativePath}`);
  }
  if (segments[0] === ".git") {
    throw new Error("Agent file operations cannot access .git");
  }

  let cursor = repoRoot;
  for (const segment of segments.slice(0, -1)) {
    cursor = path.join(cursor, segment);
    if (!(await pathExists(cursor))) continue;
    const entry = await lstat(cursor);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Symlink path component is not authorized: ${relativePath}`,
      );
    }
    if (!entry.isDirectory()) {
      throw new Error(`Parent path is not a directory: ${relativePath}`);
    }
  }

  const absolutePath = path.resolve(repoRoot, ...segments);
  if (!isInside(repoRoot, absolutePath) || absolutePath === repoRoot) {
    throw new Error(`Path escapes project root: ${relativePath}`);
  }

  if (await pathExists(absolutePath)) {
    const entry = await lstat(absolutePath);
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
      throw new Error(`Only regular files are supported: ${relativePath}`);
    }
  }
  return { absolutePath, relativePath: segments.join("/") };
}

async function loadManifest(snapshotDir) {
  return JSON.parse(
    await readFile(path.join(snapshotDir, MANIFEST_FILE), "utf8"),
  );
}

async function saveManifest(snapshotDir, manifest) {
  const target = path.join(snapshotDir, MANIFEST_FILE);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function saveBlob(snapshotDir, content) {
  const hash = sha256(content);
  const blobPath = path.join(snapshotDir, "blobs", hash);
  await mkdir(path.dirname(blobPath), { recursive: true });
  if (!(await pathExists(blobPath))) {
    await writeFile(blobPath, content, { flag: "wx" });
  }
  return hash;
}

async function captureFileState(snapshotDir, absolutePath) {
  if (!(await pathExists(absolutePath))) return { kind: "missing" };

  const entry = await lstat(absolutePath);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error(`Only regular files can be captured: ${absolutePath}`);
  }
  const content = await readFile(absolutePath);
  const hash = await saveBlob(snapshotDir, content);
  return { kind: "file", hash, mode: entry.mode & 0o777 };
}

function sameState(left, right) {
  if (left.kind !== right.kind) return false;
  return (
    left.kind === "missing" ||
    (left.hash === right.hash && left.mode === right.mode)
  );
}

function currentHead(repoRoot) {
  const result = runGit(repoRoot, ["rev-parse", "--verify", "HEAD"], {
    allowFailure: true,
  });
  return result.status === 0 ? result.stdout.toString("utf8").trim() : null;
}

function indexEntry(repoRoot, relativePath) {
  const result = runGit(repoRoot, [
    "ls-files",
    "--stage",
    "-z",
    "--",
    relativePath,
  ]);
  return result.stdout.toString("base64");
}

function captureGitStatus(repoRoot) {
  const staged = splitNul(
    runGit(repoRoot, [
      "diff",
      "--cached",
      "--name-only",
      "-z",
      "--diff-filter=ACDMRTUXB",
    ]).stdout,
  );
  const unstaged = splitNul(
    runGit(repoRoot, ["diff", "--name-only", "-z", "--diff-filter=ACDMRTUXB"])
      .stdout,
  );
  const untracked = splitNul(
    runGit(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"])
      .stdout,
  );
  const porcelain = runGit(repoRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]).stdout.toString("base64");
  return { staged, unstaged, untracked, porcelain };
}

export async function createTaskSnapshot({
  repoRoot,
  snapshotDir,
  taskId = randomUUID(),
}) {
  const resolvedRepo = await realpath(repoRoot);
  runGit(resolvedRepo, ["rev-parse", "--git-dir"]);
  await assertExternalSnapshot(resolvedRepo, snapshotDir);
  await mkdir(snapshotDir, { recursive: true });

  const manifestPath = path.join(snapshotDir, MANIFEST_FILE);
  if (await pathExists(manifestPath)) {
    throw new Error(`Snapshot already exists: ${snapshotDir}`);
  }

  const manifest = {
    schemaVersion: 1,
    taskId,
    repoRoot: resolvedRepo,
    head: currentHead(resolvedRepo),
    baselineStatus: captureGitStatus(resolvedRepo),
    mutations: [],
    createdAt: new Date().toISOString(),
  };
  await saveManifest(snapshotDir, manifest);
  return manifest;
}

async function createdParentDirectories(repoRoot, absolutePath) {
  const created = [];
  let cursor = path.dirname(absolutePath);
  while (cursor !== repoRoot && !(await pathExists(cursor))) {
    created.push(path.relative(repoRoot, cursor).split(path.sep).join("/"));
    cursor = path.dirname(cursor);
  }
  return created;
}

async function atomicWrite(absolutePath, content, mode = 0o644) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const temporary = path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, content, { mode });
    await rename(temporary, absolutePath);
    await chmod(absolutePath, mode);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function prepareMutation({
  snapshotDir,
  relativePath,
  afterState,
  createdDirectories = [],
  requireExistingFile = false,
}) {
  const manifest = await loadManifest(snapshotDir);
  if (currentHead(manifest.repoRoot) !== manifest.head) {
    throw new Error(
      "HEAD changed after the task snapshot; Agent writes are blocked",
    );
  }
  const resolved = await resolveAuthorizedPath(manifest.repoRoot, relativePath);
  const beforeState = await captureFileState(
    snapshotDir,
    resolved.absolutePath,
  );
  if (requireExistingFile && beforeState.kind !== "file") {
    throw new Error(`Cannot delete missing file: ${relativePath}`);
  }
  const normalizedAfterState =
    afterState.kind === "file"
      ? {
          ...afterState,
          mode:
            afterState.mode ??
            (beforeState.kind === "file" ? beforeState.mode : 0o644),
        }
      : afterState;
  const mutation = {
    id: randomUUID(),
    sequence: manifest.mutations.length + 1,
    path: resolved.relativePath,
    before: beforeState,
    after: normalizedAfterState,
    indexEntryBefore: indexEntry(manifest.repoRoot, resolved.relativePath),
    createdDirectories,
    state: "prepared",
  };
  manifest.mutations.push(mutation);
  await saveManifest(snapshotDir, manifest);
  return { manifest, mutation, resolved };
}

export async function agentWrite({
  snapshotDir,
  relativePath,
  content,
  failAfterPrepare = false,
}) {
  const manifest = await loadManifest(snapshotDir);
  const resolved = await resolveAuthorizedPath(manifest.repoRoot, relativePath);
  const buffer = Buffer.isBuffer(content)
    ? content
    : Buffer.from(content, "utf8");
  const afterHash = await saveBlob(snapshotDir, buffer);
  const createdDirectories = await createdParentDirectories(
    manifest.repoRoot,
    resolved.absolutePath,
  );
  const prepared = await prepareMutation({
    snapshotDir,
    relativePath: resolved.relativePath,
    afterState: { kind: "file", hash: afterHash },
    createdDirectories,
  });

  if (failAfterPrepare) return prepared.mutation;
  await atomicWrite(
    prepared.resolved.absolutePath,
    buffer,
    prepared.mutation.after.mode,
  );
  prepared.mutation.state = "applied";
  await saveManifest(snapshotDir, prepared.manifest);
  return prepared.mutation;
}

export async function agentDelete({ snapshotDir, relativePath }) {
  const prepared = await prepareMutation({
    snapshotDir,
    relativePath,
    afterState: { kind: "missing" },
    requireExistingFile: true,
  });
  await unlink(prepared.resolved.absolutePath);
  prepared.mutation.state = "applied";
  await saveManifest(snapshotDir, prepared.manifest);
  return prepared.mutation;
}

async function readStateContent(snapshotDir, state) {
  if (state.kind !== "file")
    throw new Error("Missing states do not have content");
  return readFile(path.join(snapshotDir, "blobs", state.hash));
}

function isUtf8Text(content) {
  return (
    !content.includes(0) &&
    Buffer.from(content.toString("utf8"), "utf8").equals(content)
  );
}

async function reverseMerge(snapshotDir, before, after, current) {
  if (
    before.kind !== "file" ||
    after.kind !== "file" ||
    current.kind !== "file"
  ) {
    return { kind: "conflict", reason: "create-delete-concurrent-change" };
  }

  const [beforeContent, afterContent, currentContent] = await Promise.all([
    readStateContent(snapshotDir, before),
    readStateContent(snapshotDir, after),
    readStateContent(snapshotDir, current),
  ]);
  if (![beforeContent, afterContent, currentContent].every(isUtf8Text)) {
    return { kind: "conflict", reason: "binary-concurrent-change" };
  }

  const mergeDir = await mkdtemp(
    path.join(tmpdir(), "author-copilot-reverse-merge-"),
  );
  const beforePath = path.join(mergeDir, "before");
  const afterPath = path.join(mergeDir, "after");
  const currentPath = path.join(mergeDir, "current");
  try {
    await Promise.all([
      writeFile(beforePath, beforeContent),
      writeFile(afterPath, afterContent),
      writeFile(currentPath, currentContent),
    ]);
    const result = spawnSync(
      "git",
      ["merge-file", "-p", beforePath, afterPath, currentPath],
      {
        encoding: null,
        maxBuffer: 16 * 1024 * 1024,
        shell: false,
      },
    );
    if (result.error) throw result.error;
    if (result.status === 1)
      return { kind: "conflict", reason: "overlapping-user-edit" };
    if (result.status !== 0) {
      throw new Error(
        `git merge-file failed (${result.status}): ${result.stderr.toString("utf8")}`,
      );
    }
    return { kind: "file", content: result.stdout, mode: current.mode };
  } finally {
    await rm(mergeDir, { recursive: true, force: true });
  }
}

async function applyState(
  snapshotDir,
  absolutePath,
  state,
  createdDirectories,
  repoRoot,
) {
  if (state.kind === "missing") {
    await rm(absolutePath, { force: true });
    for (const relativeDir of createdDirectories) {
      try {
        await rmdir(path.join(repoRoot, relativeDir));
      } catch (error) {
        if (!["ENOENT", "ENOTEMPTY"].includes(error.code)) throw error;
      }
    }
    return;
  }
  const content = await readStateContent(snapshotDir, state);
  await atomicWrite(absolutePath, content, state.mode);
}

export async function restoreTaskSnapshot({ snapshotDir, beforeApply }) {
  const manifest = await loadManifest(snapshotDir);
  const result = {
    status: "complete",
    restored: [],
    alreadyRestored: [],
    conflicts: [],
    failures: [],
  };

  if (currentHead(manifest.repoRoot) !== manifest.head) {
    return {
      ...result,
      status: "blocked",
      conflicts: [{ path: null, reason: "head-changed" }],
    };
  }

  const blockedPaths = new Set();
  const mutations = [...manifest.mutations].sort(
    (left, right) => right.sequence - left.sequence,
  );
  for (const mutation of mutations) {
    if (mutation.state === "restored") continue;
    if (blockedPaths.has(mutation.path)) continue;

    try {
      const resolved = await resolveAuthorizedPath(
        manifest.repoRoot,
        mutation.path,
      );
      if (
        indexEntry(manifest.repoRoot, mutation.path) !==
        mutation.indexEntryBefore
      ) {
        result.conflicts.push({
          mutationId: mutation.id,
          path: mutation.path,
          reason: "index-entry-changed",
        });
        blockedPaths.add(mutation.path);
        continue;
      }

      const current = await captureFileState(
        snapshotDir,
        resolved.absolutePath,
      );
      if (sameState(current, mutation.before)) {
        mutation.state = "restored";
        result.alreadyRestored.push(mutation.path);
        await saveManifest(snapshotDir, manifest);
        continue;
      }

      let targetState = mutation.before;
      if (!sameState(current, mutation.after)) {
        const merged = await reverseMerge(
          snapshotDir,
          mutation.before,
          mutation.after,
          current,
        );
        if (merged.kind === "conflict") {
          result.conflicts.push({
            mutationId: mutation.id,
            path: mutation.path,
            reason: merged.reason,
          });
          blockedPaths.add(mutation.path);
          continue;
        }
        const mergedHash = await saveBlob(snapshotDir, merged.content);
        targetState = { kind: "file", hash: mergedHash, mode: merged.mode };
      }

      await beforeApply?.({ mutation, targetState });
      await applyState(
        snapshotDir,
        resolved.absolutePath,
        targetState,
        mutation.createdDirectories,
        manifest.repoRoot,
      );
      mutation.state = "restored";
      result.restored.push(mutation.path);
      await saveManifest(snapshotDir, manifest);
    } catch (error) {
      result.failures.push({
        mutationId: mutation.id,
        path: mutation.path,
        reason: error.message,
      });
      blockedPaths.add(mutation.path);
    }
  }

  if (result.conflicts.length > 0 || result.failures.length > 0) {
    result.status = "partial";
  }
  return result;
}

export async function readTaskSnapshot(snapshotDir) {
  return loadManifest(snapshotDir);
}
