import { execFile } from "node:child_process";
import {
  lstat,
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { GitService } from "../src/main/git/index.js";
import type { GitServiceError } from "../src/main/git/index.js";
import { resolveGitRuntime } from "../src/main/git-runtime.js";

const execFileAsync = promisify(execFile);
const projectId = "10000000-0000-4000-8000-000000000001";
const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "author-copilot-git-"));
  temporaryRoots.push(root);
  return root;
}

function createService(rootPath: string, hooksDirectory: string): GitService {
  return new GitService({
    gitExecutable: "git",
    hooksDirectory,
    resolveProjectRoot: async (candidateProjectId) => {
      expect(candidateProjectId).toBe(projectId);
      return rootPath;
    },
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("GitService", () => {
  it("creates an application-managed version without invoking a shell", async () => {
    const root = await temporaryRoot();
    const projectRoot = join(root, "作品 $(touch escaped)");
    await mkdir(projectRoot);
    await writeFile(join(projectRoot, "author-copilot.json"), "{}\n", "utf8");
    await writeFile(join(projectRoot, "第一章.md"), "开场\n", "utf8");
    const service = createService(projectRoot, join(root, "disabled-hooks"));
    const message = "初稿 $(touch should-not-run)";

    const result = await service.createVersion(projectId, message);

    expect(result.created).toBe(true);
    if (!result.created) throw new Error("Expected a created version.");
    expect(result.version.changedFiles).toBe(2);
    const log = await execFileAsync(
      "git",
      ["-C", projectRoot, "log", "-1", "--format=%s%n%an%n%ae"],
      { encoding: "utf8" },
    );
    expect(log.stdout.trim()).toBe(
      `${message}\nAuthor Copilot\nauthor-copilot@local`,
    );
    await expect(service.createVersion(projectId, "没有变化")).resolves.toEqual(
      { created: false },
    );
  });

  it("creates a nested repository instead of using an ancestor repository", async () => {
    const root = await temporaryRoot();
    await execFileAsync("git", ["init", "--initial-branch=main", root]);
    const projectRoot = join(root, "registered-project");
    await mkdir(projectRoot);
    await writeFile(join(projectRoot, "chapter.md"), "正文\n", "utf8");
    const service = createService(projectRoot, join(root, "disabled-hooks"));

    await service.createVersion(projectId, "项目初稿");

    const repositoryRoot = await execFileAsync(
      "git",
      ["-C", projectRoot, "rev-parse", "--show-toplevel"],
      { encoding: "utf8" },
    );
    expect(repositoryRoot.stdout.trim()).toBe(await realpath(projectRoot));
  });

  it("lists versions and returns a structured first-parent diff", async () => {
    const root = await temporaryRoot();
    const projectRoot = join(root, "版本历史");
    const documentPath = join(projectRoot, "第一章.md");
    await mkdir(projectRoot);
    await writeFile(documentPath, "第一版\n", "utf8");
    const service = createService(projectRoot, join(root, "disabled-hooks"));

    const first = await service.createVersion(projectId, "初稿");
    expect(first.created).toBe(true);
    await writeFile(documentPath, "第一版\n第二段\n", "utf8");
    const second = await service.createVersion(projectId, "补充第二段");
    expect(second.created).toBe(true);
    if (!second.created) throw new Error("Expected a created version.");

    await expect(service.listVersions(projectId, 10)).resolves.toMatchObject([
      { message: "补充第二段", commitId: second.version.commitId },
      { message: "初稿" },
    ]);
    const diff = await service.getVersionDiff(
      projectId,
      second.version.commitId,
    );
    expect(diff).toMatchObject({
      commitId: second.version.commitId,
      files: [
        {
          path: "第一章.md",
          status: "modified",
          additions: 1,
          deletions: 0,
          binary: false,
        },
      ],
    });
    expect(diff.patch).toContain("+第二段");
  });

  it("does not initialize a repository while reading empty history", async () => {
    const root = await temporaryRoot();
    const projectRoot = join(root, "没有版本");
    await mkdir(projectRoot);
    const service = createService(projectRoot, join(root, "disabled-hooks"));

    await expect(service.listVersions(projectId, 50)).resolves.toEqual([]);
    await expect(lstat(join(projectRoot, ".git"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    await execFileAsync("git", ["init", "--initial-branch=main", projectRoot]);
    await expect(service.listVersions(projectId, 50)).resolves.toEqual([]);
  });

  it("rejects symbolic-link Git metadata", async () => {
    const root = await temporaryRoot();
    const projectRoot = join(root, "project");
    const externalGit = join(root, "external-git");
    await mkdir(projectRoot);
    await mkdir(externalGit);
    await symlink(externalGit, join(projectRoot, ".git"));
    const service = createService(projectRoot, join(root, "disabled-hooks"));

    await expect(service.createVersion(projectId, "初稿")).rejects.toEqual(
      expect.objectContaining<Partial<GitServiceError>>({
        code: "invalid_repository",
      }),
    );
  });

  it("rejects repository-configured content filters before staging", async () => {
    const root = await temporaryRoot();
    const projectRoot = join(root, "project");
    const markerPath = join(projectRoot, "filter-ran");
    await mkdir(projectRoot);
    await execFileAsync("git", ["init", "--initial-branch=main", projectRoot]);
    await execFileAsync("git", [
      "-C",
      projectRoot,
      "config",
      "filter.danger.clean",
      `touch ${markerPath}`,
    ]);
    await writeFile(join(projectRoot, ".gitattributes"), "* filter=danger\n");
    await writeFile(join(projectRoot, "chapter.md"), "正文\n");
    const service = createService(projectRoot, join(root, "disabled-hooks"));

    await expect(service.createVersion(projectId, "初稿")).rejects.toEqual(
      expect.objectContaining<Partial<GitServiceError>>({
        code: "invalid_repository",
      }),
    );
    await expect(lstat(markerPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("resolveGitRuntime", () => {
  it("uses an override only for development builds", () => {
    expect(
      resolveGitRuntime({
        arch: "arm64",
        developmentOverride: "/opt/test/git",
        isPackaged: false,
        platform: "darwin",
        resourcesPath: "/Applications/Author Copilot.app/Contents/Resources",
      }),
    ).toEqual({ executable: "/opt/test/git", environment: {} });
    expect(
      resolveGitRuntime({
        arch: "arm64",
        developmentOverride: "/tmp/untrusted/git",
        isPackaged: true,
        platform: "win32",
        resourcesPath: "C:\\AuthorCopilot\\resources",
      }).executable,
    ).toBe("C:\\AuthorCopilot\\resources/git/cmd/git.exe");
  });

  it("resolves packaged runtime support paths for each platform", () => {
    const mac = resolveGitRuntime({
      arch: "x64",
      isPackaged: true,
      platform: "darwin",
      resourcesPath: "/app/resources",
    });
    expect(mac.environment).toEqual({
      GIT_EXEC_PATH: "/app/resources/git/libexec/git-core",
      GIT_SSL_CAINFO: "/app/resources/git/etc/ssl/certs/ca-bundle.crt",
      GIT_TEMPLATE_DIR: "/app/resources/git/share/git-core/templates",
    });
    const windows = resolveGitRuntime({
      arch: "arm64",
      isPackaged: true,
      platform: "win32",
      resourcesPath: "C:\\app\\resources",
    });
    expect(windows.environment.GIT_EXEC_PATH).toBe(
      "C:\\app\\resources/git/clangarm64/libexec/git-core",
    );
  });
});
