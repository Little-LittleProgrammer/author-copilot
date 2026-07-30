import { readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { mkdtemp, mkdir, rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeIndexStatusResultSchema } from "@author-copilot/contracts";

import {
  chunkMarkdown,
  KnowledgeService,
  scoreKnowledgeChunk,
} from "../src/main/knowledge/index.js";
import {
  ProjectService,
  RegistryStore,
  type DocumentSavedEvent,
} from "../src/main/project/index.js";

const temporaryRoots: string[] = [];

async function fixture(
  options: {
    readonly publishEvent?: (event: DocumentSavedEvent) => void;
  } = {},
): Promise<{
  readonly base: string;
  readonly projectService: ProjectService;
  readonly projectId: string;
  readonly rootPath: string;
  readonly relativePath: string;
  readonly storageRoot: string;
}> {
  const base = await mkdtemp(join(tmpdir(), "author-copilot-knowledge-"));
  temporaryRoots.push(base);
  const projects = join(base, "作品");
  const userData = join(base, "用户数据");
  await mkdir(projects);
  const projectService = new ProjectService({
    registry: new RegistryStore(userData),
    ...(options.publishEvent === undefined
      ? {}
      : { publishEvent: options.publishEvent }),
  });
  const project = await projectService.createProject(projects, "雨夜", "novel");
  const relativePath = "第一卷/第一章/01-正文.md";
  await writeFile(
    join(project.rootPath, relativePath),
    "# 第一章\n\n雨夜里，林舟在旧车站等到了归来的人。\n\n## 线索\n\n铜钥匙藏在站台长椅下面。\n",
    "utf8",
  );
  return {
    base,
    projectService,
    projectId: project.projectId,
    rootPath: project.rootPath,
    relativePath,
    storageRoot: join(userData, "knowledge-indexes"),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Markdown knowledge chunking", () => {
  it("preserves heading context and exact one-based line ranges", () => {
    const chunks = chunkMarkdown(
      "第一卷/第一章/场景.md",
      "# 第一章\n\n第一段。\n续行。\n\n## 雨夜\n\n第二段。",
    );

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          titleContext: ["第一章"],
          startLine: 3,
          endLine: 4,
          text: "第一段。\n续行。",
        }),
        expect.objectContaining({
          titleContext: ["第一章", "雨夜"],
          startLine: 8,
          endLine: 8,
          text: "第二段。",
        }),
      ]),
    );
    const rainChunk = chunks.find((chunk) => chunk.text === "第二段。");
    expect(
      rainChunk === undefined ? 0 : scoreKnowledgeChunk(rainChunk, "雨夜"),
    ).toBeGreaterThan(0);
  });
});

describe("KnowledgeService", () => {
  it("initializes a project-isolated index and returns current source locations", async () => {
    const setup = await fixture();
    const service = new KnowledgeService({
      storageRoot: setup.storageRoot,
      projectService: setup.projectService,
    });

    const started = await service.initialize(setup.projectId);
    expect(started).toMatchObject({
      status: "updating",
      activeTaskId: expect.any(String),
    });
    await service.waitForIdle(setup.projectId);

    const status = await service.getStatus(setup.projectId);
    expect(() => KnowledgeIndexStatusResultSchema.parse(status)).not.toThrow();
    expect(status).not.toHaveProperty("schemaVersion");
    expect(status).toMatchObject({
      status: "ready",
      documentCount: 1,
      activeTaskId: null,
      lastError: null,
    });
    expect(status.chunkCount).toBeGreaterThanOrEqual(4);
    const result = await service.search(setup.projectId, "铜钥匙 站台", 5);
    expect(result.hits[0]).toMatchObject({
      relativePath: setup.relativePath,
      titleContext: ["第一章", "线索"],
      startLine: 7,
      endLine: 7,
      indexVersion: status.indexVersion,
    });

    const indexPath = join(setup.storageRoot, setup.projectId, "index.json");
    expect((await stat(indexPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(indexPath, "utf8")).not.toContain(setup.rootPath);
    await expect(
      stat(join(setup.rootPath, ".author-copilot-index")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cancels initialization without publishing a partial ready index", async () => {
    const setup = await fixture();
    let releaseYield = (): void => undefined;
    let enteredYield = (): void => undefined;
    const entered = new Promise<void>((resolve) => {
      enteredYield = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseYield = resolve;
    });
    const service = new KnowledgeService({
      storageRoot: setup.storageRoot,
      projectService: setup.projectService,
      yieldControl: async () => {
        enteredYield();
        await gate;
      },
    });

    const started = await service.initialize(setup.projectId);
    await entered;
    expect(service.cancel(started.activeTaskId ?? "missing")).toBe(true);
    releaseYield();
    await service.waitForIdle(setup.projectId);

    expect(await service.getStatus(setup.projectId)).toMatchObject({
      status: "not_initialized",
      activeTaskId: null,
      lastError: "Indexing was cancelled.",
    });
  });

  it("retries after a failed scan and recovers to ready", async () => {
    const setup = await fixture();
    let failRead = true;
    const projectSource = {
      getProjectRoot: setup.projectService.getProjectRoot.bind(
        setup.projectService,
      ),
      getStructure: setup.projectService.getStructure.bind(
        setup.projectService,
      ),
      readDocument: async (projectId: string, relativePath: string) => {
        if (failRead) throw new Error("simulated read failure");
        return setup.projectService.readDocument(projectId, relativePath);
      },
    };
    const service = new KnowledgeService({
      storageRoot: setup.storageRoot,
      projectService: projectSource,
    });

    await service.initialize(setup.projectId);
    await service.waitForIdle(setup.projectId);
    expect(await service.getStatus(setup.projectId)).toMatchObject({
      status: "not_initialized",
      lastError: "simulated read failure",
    });

    failRead = false;
    await service.initialize(setup.projectId);
    await service.waitForIdle(setup.projectId);
    expect(await service.getStatus(setup.projectId)).toMatchObject({
      status: "ready",
      lastError: null,
    });
  });

  it("recovers an interrupted updating state as stale without losing the prior index", async () => {
    const setup = await fixture();
    const service = new KnowledgeService({
      storageRoot: setup.storageRoot,
      projectService: setup.projectService,
    });
    await service.initialize(setup.projectId);
    await service.waitForIdle(setup.projectId);
    const statePath = join(setup.storageRoot, setup.projectId, "state.json");
    const readyState = JSON.parse(await readFile(statePath, "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      statePath,
      `${JSON.stringify({
        ...readyState,
        status: "updating",
        activeTaskId: "20000000-0000-4000-8000-000000000001",
      })}\n`,
      "utf8",
    );

    const restarted = new KnowledgeService({
      storageRoot: setup.storageRoot,
      projectService: setup.projectService,
    });
    expect(await restarted.getStatus(setup.projectId)).toMatchObject({
      status: "stale",
      indexVersion: readyState.indexVersion,
      activeTaskId: null,
      lastError: "Indexing was interrupted before completion.",
    });
  });

  it("updates only the saved document asynchronously and advances the index version", async () => {
    const services: { knowledge?: KnowledgeService } = {};
    const setup = await fixture({
      publishEvent: (event) => services.knowledge?.handleDocumentSaved(event),
    });
    const knowledgeService = new KnowledgeService({
      storageRoot: setup.storageRoot,
      projectService: setup.projectService,
    });
    services.knowledge = knowledgeService;
    await knowledgeService.initialize(setup.projectId);
    await knowledgeService.waitForIdle(setup.projectId);
    const before = await knowledgeService.getStatus(setup.projectId);
    const document = await setup.projectService.readDocument(
      setup.projectId,
      setup.relativePath,
    );

    await setup.projectService.saveDocument(
      setup.projectId,
      setup.relativePath,
      `${document.content}\n增量标记：白塔钟声。\n`,
      document.hash,
    );
    await yieldToEventLoop();
    await knowledgeService.waitForIdle(setup.projectId);

    const after = await knowledgeService.getStatus(setup.projectId);
    expect(after.status).toBe("ready");
    expect(after.indexVersion).not.toBe(before.indexVersion);
    expect(
      (await knowledgeService.search(setup.projectId, "白塔钟声", 5)).hits,
    ).toEqual([expect.objectContaining({ relativePath: setup.relativePath })]);
  });

  it("marks the index stale after an external file change and rejects search", async () => {
    const setup = await fixture();
    const service = new KnowledgeService({
      storageRoot: setup.storageRoot,
      projectService: setup.projectService,
    });
    await service.initialize(setup.projectId);
    await service.waitForIdle(setup.projectId);

    await writeFile(
      join(setup.rootPath, setup.relativePath),
      "# 外部改写\n\n内容已经改变，而且长度不同。\n",
      "utf8",
    );

    expect(await service.getStatus(setup.projectId)).toMatchObject({
      status: "stale",
      lastError: "A project document changed on disk.",
    });
    await expect(
      service.search(setup.projectId, "外部改写", 5),
    ).rejects.toMatchObject({
      code: "unavailable",
    });

    await service.rebuild(setup.projectId);
    await service.waitForIdle(setup.projectId);
    expect(await service.getStatus(setup.projectId)).toMatchObject({
      status: "ready",
      lastError: null,
    });
    expect(
      (await service.search(setup.projectId, "外部改写", 5)).hits[0],
    ).toMatchObject({ relativePath: setup.relativePath, startLine: 1 });
  });

  it("does not reuse an index when the same project ID resolves to another root", async () => {
    const setup = await fixture();
    const service = new KnowledgeService({
      storageRoot: setup.storageRoot,
      projectService: setup.projectService,
    });
    await service.initialize(setup.projectId);
    await service.waitForIdle(setup.projectId);

    const copiedRoot = join(setup.base, "复制作品");
    await mkdir(join(copiedRoot, "第一卷", "第一章"), { recursive: true });
    await writeFile(
      join(copiedRoot, setup.relativePath),
      "# 副本\n\n这不是原索引。\n",
      "utf8",
    );
    const otherRootService = new KnowledgeService({
      storageRoot: setup.storageRoot,
      projectService: {
        getProjectRoot: async () => copiedRoot,
        getStructure: async () => ({
          projectId: setup.projectId,
          template: "novel" as const,
          nodes: [
            {
              kind: "volume" as const,
              name: "第一卷",
              relativePath: "第一卷",
              children: [
                {
                  kind: "chapter" as const,
                  name: "第一章",
                  relativePath: "第一卷/第一章",
                  children: [
                    {
                      kind: "document" as const,
                      name: "01-正文",
                      relativePath: setup.relativePath,
                    },
                  ],
                },
              ],
            },
          ],
          unclassified: [],
        }),
        readDocument: async () => ({
          content: "# 副本\n\n这不是原索引。\n",
          hash: "unused",
          mtimeMs: 0,
          mode: 0o600,
        }),
      },
    });

    expect(await otherRootService.getStatus(setup.projectId)).toMatchObject({
      status: "stale",
      lastError: "The project document set changed.",
    });
  });
});
