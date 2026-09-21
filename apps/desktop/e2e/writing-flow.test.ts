import type { AuthorCopilotApi } from "../src/shared/desktop-api.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import type { WebContentsView } from "electron";

import { TaskSnapshotService } from "../src/main/git/task-snapshot-service.js";

const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);
const execFileAsync = promisify(execFile);

async function rendererPage(
  application: ElectronApplication,
  context: "center" | "project" | "shell",
): Promise<Page> {
  await expect
    .poll(async () => {
      const matches = await Promise.all(
        application
          .windows()
          .map((page) =>
            page.locator(`body[data-renderer-context="${context}"]`).count(),
          ),
      );
      return matches.reduce((total, count) => total + count, 0);
    })
    .toBeGreaterThan(0);
  for (const candidate of application.windows()) {
    if (
      (await candidate
        .locator(`body[data-renderer-context="${context}"]`)
        .count()) > 0
    ) {
      return candidate;
    }
  }
  throw new Error(`Renderer context ${context} was not found`);
}

async function enterWorkspace(
  application: ElectronApplication,
): Promise<{ readonly center: Page; readonly shell: Page }> {
  const shell = await application.firstWindow();
  await expect(shell.locator(".app-tabs")).toHaveCount(0);
  await shell.getByTestId("continue-local").click();
  const center = await rendererPage(application, "center");
  await expect(center.getByText(/我的作品|My works/u)).toBeVisible();
  await expect(
    shell.locator(".app-tabs").getByRole("tab", {
      name: /作家中心|Writer center/u,
    }),
  ).toHaveAttribute("aria-selected", "true");
  return { center, shell };
}

async function launchApplication(
  temporaryRoot: string,
  environment: Readonly<Record<string, string>> = {},
): Promise<ElectronApplication> {
  return electron.launch({
    args: ["."],
    cwd: resolve(import.meta.dirname, ".."),
    env: {
      ...inheritedEnvironment,
      AUTHOR_COPILOT_E2E: "1",
      AUTHOR_COPILOT_E2E_DIRECTORY: temporaryRoot,
      AUTHOR_COPILOT_E2E_USER_DATA: join(temporaryRoot, ".user-data"),
      ...environment,
    },
  });
}

async function openAssistant(
  page: Page,
  mode: "chat" | "agent" | "knowledge" = "chat",
): Promise<void> {
  const toggle = page.getByRole("button", {
    name: /AI 对话|AI chat/u,
    exact: true,
  });
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  const label =
    mode === "agent"
      ? /Agent 任务|Agent/u
      : mode === "knowledge"
        ? /知识库|Knowledge/u
        : /对话|Chat/u;
  await page
    .getByTestId("assistant-dock")
    .getByRole("button", { name: label, exact: true })
    .click();
}

async function closeWorkspacePanel(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible())
    await dialog
      .getByRole("button", {
        name: /^(关闭|Close) (历史记录|History|审阅 AI 修改建议|Review AI suggestions)$/u,
      })
      .click();
  else
    await page
      .getByTestId("assistant-dock")
      .getByRole("button", { name: /^(关闭|Close)$/u })
      .click();
}

async function nativeViewState(application: ElectronApplication): Promise<{
  readonly bounds: readonly {
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  readonly childCount: number;
}> {
  return application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const bounds =
      window?.contentView.children.map((view) => view.getBounds()) ?? [];
    return { bounds, childCount: bounds.length };
  });
}

test("creates, edits, saves, and protects an externally changed novel", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "author-copilot-e2e-"));
  const projectTitle = "E2E 写作项目";
  const projectRoot = join(temporaryRoot, projectTitle);
  const documentPath = join(projectRoot, "第一卷", "第一章", "01-正文.md");
  const application = await launchApplication(temporaryRoot);

  try {
    const { center, shell } = await enterWorkspace(application);
    await center.getByRole("button", { name: /新建小说|New novel/u }).click();
    await center.getByTestId("project-name").fill(projectTitle);
    await center.getByTestId("project-dialog-submit").click();

    const appTabs = shell.locator(".app-tabs");
    await expect(
      appTabs.getByRole("tab", { name: projectTitle }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(appTabs.getByRole("tab")).toHaveCount(2);
    await appTabs.getByRole("tab", { name: /作家中心|Writer center/u }).click();
    await center
      .getByRole("button", {
        name: /打开作品.*E2E 写作项目|Open work.*E2E 写作项目/u,
      })
      .click();
    await expect(appTabs.getByRole("tab")).toHaveCount(2);

    const page = await rendererPage(application, "project");
    await page.getByRole("button", { name: "01-正文", exact: true }).click();
    const editor = page.getByTestId("document-editor");
    await editor.fill("保存时的正文");
    await editor.evaluate((element) => {
      const save = document.querySelector<HTMLButtonElement>(
        '[data-testid="save-document"]',
      );
      if (save === null) throw new Error("Missing save button");
      save.click();
      // Keep this edit in the same renderer turn, before the IPC reply can arrive.
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(element, "保存时的正文 + 等待期间的新输入");
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect
      .poll(() => readFile(documentPath, "utf8"))
      .toBe("保存时的正文");
    await expect(page.getByTestId("save-document")).toBeEnabled();
    await expect(editor).toHaveValue("保存时的正文 + 等待期间的新输入");
    await editor.fill("# 第一场\n\n夜雨落在站台上。\n");
    await page.getByTestId("save-document").click();
    await expect(page.getByText(/已保存|Saved/u)).toBeVisible();
    await expect
      .poll(() => readFile(documentPath, "utf8"))
      .toContain("夜雨落在站台上");
    await page.getByTestId("save-version").click();
    await page.getByTestId("version-message").fill("保存第一场");
    await page.screenshot({
      path: "test-results/m3-save-version-dialog.png",
      fullPage: true,
    });
    await page.getByTestId("version-dialog-submit").click();
    await expect(page.getByText(/版本已保存|Version saved/u)).toBeVisible();
    const versionLog = await execFileAsync(
      "git",
      ["-C", projectRoot, "log", "-1", "--format=%s"],
      { encoding: "utf8" },
    );
    expect(versionLog.stdout.trim()).toBe("保存第一场");
    await execFileAsync("git", [
      "-C",
      projectRoot,
      "switch",
      "-c",
      "备选-结局",
    ]);
    await writeFile(documentPath, "# 备选结局\n\n列车驶入晨光。\n", "utf8");
    await execFileAsync("git", ["-C", projectRoot, "add", "--all"]);
    await execFileAsync("git", [
      "-C",
      projectRoot,
      "-c",
      "user.name=E2E",
      "-c",
      "user.email=e2e@example.com",
      "commit",
      "-m",
      "保存备选结局",
    ]);
    await execFileAsync("git", ["-C", projectRoot, "switch", "main"]);
    await page
      .getByRole("button", { name: /历史记录|History/u, exact: true })
      .click();
    await expect(
      page.getByTestId("version-history-item").first(),
    ).toContainText("保存第一场");
    await expect(page.locator(".version-file-list")).toContainText(
      "01-正文.md",
    );
    await expect(page.getByTestId("version-diff")).toContainText(
      "夜雨落在站台上",
    );
    await page.screenshot({
      path: "test-results/m3-version-history-diff.png",
      fullPage: true,
    });
    const branchSwitcher = page.getByTestId("branch-switcher");
    await branchSwitcher
      .getByRole("combobox", { name: /分支|Branch/u })
      .selectOption("备选-结局");
    await branchSwitcher
      .getByRole("button", { name: /切换分支|Switch branch/u })
      .click();
    await expect(branchSwitcher).toContainText(/分支已切换|Branch switched/u);
    await expect(page.getByTestId("version-diff")).toContainText(
      "列车驶入晨光",
    );
    await page.screenshot({
      path: "test-results/m3-branch-switch.png",
      fullPage: true,
    });
    await closeWorkspacePanel(page);
    await expect(editor).toHaveValue("# 备选结局\n\n列车驶入晨光。\n");
    await page
      .getByRole("button", { name: /历史记录|History/u, exact: true })
      .click();
    await branchSwitcher
      .getByRole("combobox", { name: /分支|Branch/u })
      .selectOption("main");
    await branchSwitcher
      .getByRole("button", { name: /切换分支|Switch branch/u })
      .click();
    await expect(branchSwitcher).toContainText(/分支已切换|Branch switched/u);
    await closeWorkspacePanel(page);
    await expect(editor).toHaveValue("# 第一场\n\n夜雨落在站台上。\n");
    await page.screenshot({
      path: "test-results/m2-writing-workspace.png",
      fullPage: true,
    });

    await writeFile(documentPath, "# 外部版本\n", "utf8");
    await editor.fill("# 编辑器版本\n");
    await page.getByTestId("save-document").click();
    await expect(page.getByRole("alert")).toContainText(
      /外部修改|changed on disk/u,
    );
    await expect
      .poll(() => readFile(documentPath, "utf8"))
      .toBe("# 外部版本\n");
  } finally {
    await application.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("creates the screenplay structure through the desktop workflow", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "author-copilot-e2e-"));
  const projectTitle = "E2E 剧本";
  const application = await launchApplication(temporaryRoot);

  try {
    const { center } = await enterWorkspace(application);
    await center
      .getByRole("button", { name: /新建剧本|New screenplay/u })
      .click();
    await center.getByTestId("project-name").fill(projectTitle);
    await center.getByTestId("project-dialog-submit").click();
    const page = await rendererPage(application, "project");
    await page.getByRole("button", { name: "01-第一场", exact: true }).click();
    await expect(page.getByTestId("document-editor")).toHaveValue("");
    await assert.doesNotReject(
      lstat(join(temporaryRoot, projectTitle, "第一幕", "01-第一场.md")),
    );
  } finally {
    await application.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("restores an Agent task from history without losing the task-start file", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "author-copilot-e2e-"));
  const projectTitle = "E2E 任务恢复";
  const application = await launchApplication(temporaryRoot);

  try {
    const { center } = await enterWorkspace(application);
    await center.getByRole("button", { name: /新建小说|New novel/u }).click();
    await center.getByTestId("project-name").fill(projectTitle);
    await center.getByTestId("project-dialog-submit").click();
    const page = await rendererPage(application, "project");
    await page.getByRole("button", { name: "01-正文", exact: true }).click();
    const editor = page.getByTestId("document-editor");
    const taskStartContent = "# 任务前版本\n\n保留这一段。\n";
    await editor.fill(taskStartContent);
    await page.getByTestId("save-document").click();
    await page.getByTestId("save-version").click();
    await page.getByTestId("version-message").fill("任务前版本");
    await page.getByTestId("version-dialog-submit").click();
    await expect(page.getByText(/版本已保存|Version saved/u)).toBeVisible();

    const registry = JSON.parse(
      await readFile(
        join(temporaryRoot, ".user-data", "projects.json"),
        "utf8",
      ),
    ) as {
      projects: Record<string, { projectId: string; rootPath: string }>;
    };
    const project = Object.values(registry.projects)[0];
    assert.ok(project);
    const taskService = new TaskSnapshotService({
      gitExecutable: process.env.AUTHOR_COPILOT_GIT_EXECUTABLE ?? "git",
      isolationDirectory: join(
        temporaryRoot,
        ".user-data",
        "git-hooks-disabled",
      ),
      snapshotsRoot: join(temporaryRoot, ".user-data", "task-snapshots"),
      resolveProjectRoot: async () => project.rootPath,
    });
    const taskId = randomUUID();
    await taskService.createTaskSnapshot(project.projectId, taskId);
    await taskService.writeTaskFile(
      project.projectId,
      taskId,
      "第一卷/第一章/01-正文.md",
      "# Agent 改写\n\n这段应被恢复。\n",
    );

    await page
      .getByRole("button", { name: /历史记录|History/u, exact: true })
      .click();
    const recovery = page.getByTestId("task-recovery");
    await expect(recovery).toContainText(/恢复 Agent 任务|Recover Agent task/u);
    page.once("dialog", (dialog) => dialog.accept());
    await recovery
      .getByRole("button", { name: /恢复任务|Restore task/u })
      .click();
    await expect(recovery).toContainText(
      /任务改动已恢复|Task changes restored/u,
    );
    await page.screenshot({
      path: "test-results/m3-task-recovery-result.png",
      fullPage: true,
    });
    await expect
      .poll(() =>
        readFile(
          join(project.rootPath, "第一卷", "第一章", "01-正文.md"),
          "utf8",
        ),
      )
      .toBe(taskStartContent);
    await closeWorkspacePanel(page);
    await expect(editor).toHaveValue(taskStartContent);
  } finally {
    await application.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("keeps native project views alive across switches and destroys them on close", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "author-copilot-e2e-"));
  const projectTitle = "原生标签项目";
  const application = await launchApplication(temporaryRoot);

  try {
    const { center, shell } = await enterWorkspace(application);
    await expect
      .poll(() => nativeViewState(application))
      .toMatchObject({
        childCount: 1,
      });
    await center.getByRole("button", { name: /新建小说|New novel/u }).click();
    await center.getByTestId("project-name").fill(projectTitle);
    await center.getByTestId("project-dialog-submit").click();
    const project = await rendererPage(application, "project");
    await expect
      .poll(() => nativeViewState(application))
      .toMatchObject({
        childCount: 2,
      });

    await project.getByRole("button", { name: "01-正文", exact: true }).click();
    await project.getByTestId("document-editor").fill("尚未保存的原生标签内容");
    const projectTab = shell
      .locator(".app-tabs")
      .getByRole("tab", { name: projectTitle });
    await expect(projectTab.locator(".app-tab-dirty")).toBeVisible();

    await shell
      .locator(".app-tabs")
      .getByRole("tab", { name: /作家中心|Writer center/u })
      .click();
    await projectTab.click();
    await expect(project.getByTestId("document-editor")).toHaveValue(
      "尚未保存的原生标签内容",
    );

    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(940, 680);
    });
    await expect
      .poll(async () => (await nativeViewState(application)).bounds)
      .toEqual([
        { x: 0, y: 42, width: 940, height: 638 },
        { x: 0, y: 42, width: 940, height: 638 },
      ]);

    const screenshot = await application.evaluate(
      async ({ BrowserWindow, nativeImage }) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (window === undefined) return [];
        const child = window.contentView.children.find(
          (view) => "webContents" in view && view.getVisible(),
        );
        if (child === undefined) return [];
        const shellImage = await window.webContents.capturePage();
        const childImage = await (
          child as WebContentsView
        ).webContents.capturePage();
        const shellSize = shellImage.getSize(1);
        const childSize = childImage.getSize(1);
        const shellBitmap = Buffer.from(
          shellImage.toBitmap({ scaleFactor: 1 }),
        );
        const childBitmap = childImage.toBitmap({ scaleFactor: 1 });
        const contentSize = window.getContentSize();
        const shellScale =
          shellSize.width / (contentSize[0] ?? shellSize.width);
        const shellPixelWidth = shellSize.width;
        const shellPixelHeight = shellSize.height;
        const childPixelWidth = childSize.width;
        const childPixelHeight = childSize.height;
        const tabBarPixelHeight = 42 * shellScale;
        const rowBytes = Math.min(shellPixelWidth, childPixelWidth) * 4;
        const rows = Math.min(
          childPixelHeight,
          shellPixelHeight - tabBarPixelHeight,
        );
        for (let row = 0; row < rows; row += 1) {
          childBitmap.copy(
            shellBitmap,
            (row + tabBarPixelHeight) * shellPixelWidth * 4,
            row * childPixelWidth * 4,
            row * childPixelWidth * 4 + rowBytes,
          );
        }
        return [
          ...nativeImage
            .createFromBitmap(shellBitmap, {
              width: shellPixelWidth,
              height: shellPixelHeight,
              scaleFactor: 1,
            })
            .toPNG(),
        ];
      },
    );
    expect(screenshot.length).toBeGreaterThan(1_000);
    await writeFile(
      "test-results/native-tabs-window.png",
      Buffer.from(screenshot),
    );

    await shell
      .getByRole("button", {
        name: new RegExp(
          `关闭标签页: ${projectTitle}|Close tab: ${projectTitle}`,
          "u",
        ),
      })
      .click();
    await expect(shell.locator(".app-tabs").getByRole("tab")).toHaveCount(1);
    await expect
      .poll(() => nativeViewState(application))
      .toMatchObject({
        childCount: 1,
      });
    await expect.poll(() => project.isClosed()).toBe(true);
  } finally {
    await application.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("fills the writing page and edits work, volume, chapter, and document names", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "author-copilot-e2e-"));
  const projectTitle = "待修改作品";
  const projectRoot = join(temporaryRoot, projectTitle);
  const application = await launchApplication(temporaryRoot);

  try {
    const { center, shell } = await enterWorkspace(application);
    await center.getByRole("button", { name: /新建小说|New novel/u }).click();
    await center.getByTestId("project-name").fill(projectTitle);
    await center.getByTestId("project-dialog-submit").click();
    const page = await rendererPage(application, "project");
    await page.getByRole("button", { name: "01-正文", exact: true }).click();

    const editor = page.getByTestId("document-editor");
    const editorBox = await editor.boundingBox();
    const pageBox = await page.locator("body").boundingBox();
    expect(editorBox).not.toBeNull();
    expect(pageBox).not.toBeNull();
    expect(editorBox?.height ?? 0).toBeGreaterThan(
      (pageBox?.height ?? 0) * 0.6,
    );
    await expect(page.locator("body")).not.toContainText(/Markdown|\.md/u, {
      useInnerText: true,
    });

    await page
      .getByRole("button", { name: /修改作品信息|Edit work information/u })
      .click();
    await page.getByTestId("project-title").fill("新作品名");
    await page.getByTestId("project-info-submit").click();
    await expect(
      shell.locator(".app-tabs").getByRole("tab", { name: "新作品名" }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: /重命名.*01-正文|Rename.*01-正文/u })
      .click();
    await page
      .getByRole("textbox", { name: /重命名|Rename/u, exact: true })
      .fill("开场");
    await page
      .getByRole("button", { name: /确认重命名|Confirm rename/u })
      .click();
    await expect(
      page.getByRole("button", { name: "开场", exact: true }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: /重命名.*第一章|Rename.*第一章/u })
      .click();
    await page
      .getByRole("textbox", { name: /重命名|Rename/u, exact: true })
      .fill("序章");
    await page
      .getByRole("button", { name: /确认重命名|Confirm rename/u })
      .click();
    await page
      .getByRole("button", { name: /重命名.*第一卷|Rename.*第一卷/u })
      .click();
    await page
      .getByRole("textbox", { name: /重命名|Rename/u, exact: true })
      .fill("上卷");
    await page
      .getByRole("button", { name: /确认重命名|Confirm rename/u })
      .click();

    await expect(page.locator(".document-title h2")).toHaveText("开场");
    await expect(
      page.getByRole("button", { name: "上卷", exact: true }),
    ).toBeVisible();
    await assert.doesNotReject(
      lstat(join(projectRoot, "上卷", "序章", "开场.md")),
    );

    await page
      .getByRole("button", { name: "开场", exact: true })
      .click({ button: "right" });
    await expect(
      page.getByRole("menuitem", { name: /编辑名称|Edit name/u }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /删除|Delete/u }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/structure-context-menu.png",
      fullPage: true,
    });
    await page
      .getByRole("menuitem", { name: /添加到 AI 上下文|Add to AI context/u })
      .click();
    await expect(
      page.getByLabel(/已加入 AI 上下文|Included in AI context/u),
    ).toBeVisible();
    await openAssistant(page, "knowledge");
    await expect(
      page.getByRole("region", { name: /AI 上下文|AI context/u }),
    ).toContainText("开场");
    await closeWorkspacePanel(page);

    await page.screenshot({
      path: "test-results/editable-writing-workspace.png",
      fullPage: true,
    });

    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "序章", exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: /删除|Delete/u }).click();
    await expect(page.getByTestId("document-editor")).toHaveCount(0);
    await assert.rejects(lstat(join(projectRoot, "上卷", "序章")), {
      code: "ENOENT",
    });
  } finally {
    await application.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("initializes and searches the local whole-work index with source navigation", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "author-copilot-e2e-"));
  const application = await launchApplication(temporaryRoot);

  try {
    const { center } = await enterWorkspace(application);
    await center.getByRole("button", { name: /新建小说|New novel/u }).click();
    await center.getByTestId("project-name").fill("索引证据");
    await center.getByTestId("project-dialog-submit").click();
    const page = await rendererPage(application, "project");
    await page.getByRole("button", { name: "01-正文", exact: true }).click();
    await page
      .getByTestId("document-editor")
      .fill("# 雨夜\n\n白塔钟声响起，林舟在旧站台等候。\n");
    await page.getByTestId("save-document").click();
    await expect(
      page.getByText(/已保存|Saved/u, { exact: true }),
    ).toBeVisible();

    await openAssistant(page, "knowledge");
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: /初始化|Initialize/u, exact: true })
      .click();
    await expect(
      page.getByTestId("knowledge-panel").getByText(/^(可用|Ready)$/u),
    ).toBeVisible({
      timeout: 10_000,
    });
    await page
      .getByRole("searchbox", { name: /检索|Search/u })
      .fill("白塔钟声");
    await page
      .getByRole("button", { name: /检索|Search/u, exact: true })
      .click();
    const result = page.getByRole("button", { name: /白塔钟声/u });
    await expect(result).toContainText("第一卷", { timeout: 10_000 });
    await page.screenshot({
      path: "test-results/m4-knowledge-index.png",
      fullPage: true,
    });
    await result.click();
    await expect(page.getByTestId("document-editor")).toHaveValue(/白塔钟声/u);
  } finally {
    await application.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("streams a BYOK Claude answer and opens its local source", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "author-copilot-e2e-"));
  const receivedKeys: string[] = [];
  const server = createServer((request, response) => {
    receivedKeys.push(String(request.headers["x-api-key"] ?? ""));
    response.writeHead(200, {
      "content-type": "text/event-stream",
      connection: "close",
    });
    const events = [
      {
        type: "message_start",
        message: {
          id: "msg_e2e",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "林舟记得" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "白塔钟声。[1]" },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 4 },
      },
      { type: "message_stop" },
    ];
    response.end(
      events
        .map(
          (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        )
        .join(""),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Claude E2E server did not expose a port.");
  }
  const apiKey = "sk-ant-api03-e2e-chat-secret";
  const application = await launchApplication(temporaryRoot, {
    AUTHOR_COPILOT_E2E_ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
    AUTHOR_COPILOT_E2E_CREDENTIAL_ENCRYPTION: "1",
  });

  try {
    const { center } = await enterWorkspace(application);
    await center.getByRole("button", { name: /Claude API Key/u }).click();
    await center.getByTestId("anthropic-api-key").fill(apiKey);
    await center.getByTestId("anthropic-credential-save").click();
    await expect(center.getByTestId("anthropic-credential-status")).toHaveText(
      /已配置|Configured/u,
    );
    await center.getByRole("button", { name: /关闭|Close/u }).click();

    await center.getByRole("button", { name: /新建小说|New novel/u }).click();
    await center.getByTestId("project-name").fill("Claude 来源对话");
    await center.getByTestId("project-dialog-submit").click();
    const page = await rendererPage(application, "project");
    await page.getByRole("button", { name: "01-正文", exact: true }).click();
    await page
      .getByTestId("document-editor")
      .fill("# 雨夜\n\n白塔钟声响起，林舟在旧站台等候。\n");
    await page.getByTestId("save-document").click();
    await expect(
      page.getByText(/已保存|Saved/u, { exact: true }),
    ).toBeVisible();

    await openAssistant(page, "knowledge");
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: /初始化|Initialize/u, exact: true })
      .click();
    await expect(
      page.getByTestId("knowledge-panel").getByText(/^(可用|Ready)$/u),
    ).toBeVisible({
      timeout: 10_000,
    });
    await openAssistant(page);
    await page.getByTestId("ai-chat-input").fill("白塔钟声");
    await page.getByTestId("ai-chat-send").click();
    await expect(page.getByTestId("ai-chat-panel")).toContainText(
      "林舟记得白塔钟声。[1]",
    );
    await expect(
      page.getByText(/使用当前文档和全书来源|full-book sources/u),
    ).toBeVisible();
    const source = page.getByRole("button", { name: /\[1\].*01-正文/u });
    await expect(source).toBeVisible();
    await page.screenshot({
      path: "test-results/m5-3-streaming-chat.png",
      fullPage: true,
    });
    await source.click();
    await expect(page.getByTestId("document-editor")).toHaveValue(/白塔钟声/u);
    await openAssistant(page);
    await expect(page.getByTestId("ai-chat-panel")).toContainText(
      "林舟记得白塔钟声。[1]",
    );
    expect(receivedKeys).toEqual([apiKey]);
  } finally {
    await application.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) =>
        error === undefined ? resolve() : reject(error),
      ),
    );
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("reviews and applies selected Claude changes into a Git version", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "author-copilot-e2e-"));
  const projectTitle = "Claude 提案审阅";
  const content = "雨夜，她开门。";
  const documentPath = join(
    temporaryRoot,
    projectTitle,
    "第一卷",
    "第一章",
    "01-正文.md",
  );
  const baselineHash = createHash("sha256").update(content).digest("hex");
  let requestBody = "";
  const server = createServer((request, response) => {
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      requestBody += chunk;
    });
    request.on("end", () => {
      const proposal = {
        summary: "加强雨夜开场",
        files: [
          {
            relativePath: "第一卷/第一章/01-正文.md",
            baselineHash,
            edits: [
              {
                changeId: "opening",
                startOffset: 0,
                endOffset: 2,
                expectedText: "雨夜",
                replacementText: "暴雨之夜",
              },
              {
                changeId: "action",
                startOffset: 4,
                endOffset: 6,
                expectedText: "开门",
                replacementText: "推门而入",
              },
            ],
          },
        ],
      };
      const events = [
        {
          type: "message_start",
          message: {
            id: "msg_proposal",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-6",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_proposal",
            name: "propose_project_changes",
            input: {},
          },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify(proposal),
          },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "tool_use", stop_sequence: null },
          usage: { output_tokens: 10 },
        },
        { type: "message_stop" },
      ];
      response.writeHead(200, {
        "content-type": "text/event-stream",
        connection: "close",
      });
      response.end(
        events
          .map(
            (event) =>
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          )
          .join(""),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address !== null && typeof address !== "string");
  const application = await launchApplication(temporaryRoot, {
    AUTHOR_COPILOT_E2E_ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
    AUTHOR_COPILOT_E2E_CREDENTIAL_ENCRYPTION: "1",
  });

  try {
    const { center } = await enterWorkspace(application);
    await center.getByRole("button", { name: /Claude API Key/u }).click();
    await center
      .getByTestId("anthropic-api-key")
      .fill("sk-ant-api03-proposal-e2e");
    await center.getByTestId("anthropic-credential-save").click();
    await center.getByRole("button", { name: /关闭|Close/u }).click();

    await center.getByRole("button", { name: /新建小说|New novel/u }).click();
    await center.getByTestId("project-name").fill(projectTitle);
    await center.getByTestId("project-dialog-submit").click();
    const page = await rendererPage(application, "project");
    await page.getByRole("button", { name: "01-正文", exact: true }).click();
    await page.getByTestId("document-editor").fill(content);
    await page.getByTestId("save-document").click();
    await expect(
      page.getByText(/已保存|Saved/u, { exact: true }),
    ).toBeVisible();

    await openAssistant(page);
    await page.getByTestId("ai-chat-input").fill("加强开场的紧张感");
    await page.getByTestId("ai-proposal-create").click();

    const review = page.getByTestId("proposal-review");
    await expect(review).toBeVisible();
    await expect(review).toContainText("加强雨夜开场");
    await expect(page.getByTestId("proposal-accepted-count")).toContainText(
      "2/2",
    );
    await expect(page.getByTestId("proposal-change-opening")).toContainText(
      "-雨夜",
    );
    await page
      .getByTestId("proposal-change-opening")
      .getByRole("button")
      .click();
    await expect(page.getByTestId("proposal-accepted-count")).toContainText(
      "1/2",
    );
    await page.getByRole("button", { name: /接受此文件|Accept file/u }).click();
    await expect(page.getByTestId("proposal-accepted-count")).toContainText(
      "2/2",
    );
    await page
      .getByTestId("proposal-change-action")
      .getByRole("button")
      .click();
    await expect(page.getByTestId("proposal-accepted-count")).toContainText(
      "1/2",
    );
    await page.screenshot({
      path: "test-results/m5-6-proposal-review.png",
      fullPage: true,
    });

    expect(await readFile(documentPath, "utf8")).toBe(content);
    await closeWorkspacePanel(page);
    await page
      .getByTestId("document-editor")
      .fill(`${content}作者尚未保存的补充`);
    await page
      .getByRole("button", {
        name: /审阅 AI 修改建议|Review AI suggestions/u,
        exact: true,
      })
      .click();
    await expect(page.getByTestId("proposal-apply")).toBeDisabled();
    expect(await readFile(documentPath, "utf8")).toBe(content);
    await closeWorkspacePanel(page);
    await expect(page.getByTestId("document-editor")).toHaveValue(
      `${content}作者尚未保存的补充`,
    );
    // Restore the original buffer deliberately; applying can now proceed.
    await page.getByTestId("document-editor").fill(content);
    await page
      .getByRole("button", {
        name: /审阅 AI 修改建议|Review AI suggestions/u,
        exact: true,
      })
      .click();
    await page.getByTestId("proposal-apply").click();
    await expect(page.getByTestId("document-editor")).toHaveValue(
      "暴雨之夜，她开门。",
    );
    expect(await readFile(documentPath, "utf8")).toBe("暴雨之夜，她开门。");
    const latestVersion = await execFileAsync(
      "git",
      ["-C", join(temporaryRoot, projectTitle), "log", "-1", "--format=%s"],
      { encoding: "utf8" },
    );
    expect(latestVersion.stdout.trim()).toBe("AI: 加强雨夜开场");
    expect(JSON.parse(requestBody)).toMatchObject({
      tool_choice: { type: "tool", name: "propose_project_changes" },
    });
  } finally {
    await application.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) =>
        error === undefined ? resolve() : reject(error),
      ),
    );
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("previews a complex Markdown folder before in-place import", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "author-copilot-e2e-"));
  const sourceRoot = join(temporaryRoot, "旧作品");
  const metadataPath = join(sourceRoot, "author-copilot.json");
  await mkdir(join(sourceRoot, "第一卷", "第一章"), { recursive: true });
  await writeFile(
    join(sourceRoot, "第一卷", "第一章", "01-开场.md"),
    "# 已有开场\n",
    "utf8",
  );
  await writeFile(join(sourceRoot, "散落 笔记.md"), "不能丢失\n", "utf8");
  const application = await launchApplication(temporaryRoot, {
    AUTHOR_COPILOT_E2E_IMPORT_SOURCE: sourceRoot,
  });

  try {
    const { center } = await enterWorkspace(application);
    await center.getByRole("button", { name: /导入作品|Import work/u }).click();
    await center
      .getByRole("button", { name: /选择文件夹|Choose folder/u })
      .click();
    await expect(center.getByText("第一卷")).toBeVisible();
    await expect(center.getByText("散落 笔记")).toBeVisible();
    await assert.rejects(lstat(metadataPath), { code: "ENOENT" });

    await center.getByTestId("project-dialog-submit").click();
    const page = await rendererPage(application, "project");
    await page.getByRole("button", { name: "01-开场", exact: true }).click();
    await expect(page.getByTestId("document-editor")).toHaveValue(
      "# 已有开场\n",
    );
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
      template: string;
    };
    expect(metadata.template).toBe("novel");
  } finally {
    await application.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("configures and removes an encrypted Anthropic API key", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "author-copilot-e2e-"));
  const credentialPath = join(
    temporaryRoot,
    ".user-data",
    "credentials",
    "secure-credentials.json",
  );
  const apiKey = "sk-ant-api03-e2e-secret";
  const application = await launchApplication(temporaryRoot, {
    AUTHOR_COPILOT_E2E_CREDENTIAL_ENCRYPTION: "1",
  });

  try {
    const { center: page } = await enterWorkspace(application);
    await page.getByRole("button", { name: /Claude API Key/u }).click();
    await expect(page.getByTestId("anthropic-credential-dialog")).toBeVisible();
    await expect(page.getByTestId("anthropic-credential-status")).toHaveText(
      /未配置|Not configured/u,
    );

    await page.getByTestId("anthropic-api-key").fill(apiKey);
    await page.getByTestId("anthropic-credential-save").click();
    await expect(page.getByTestId("anthropic-credential-status")).toHaveText(
      /已配置|Configured/u,
    );
    await expect(page.getByTestId("anthropic-api-key")).toHaveValue("");
    await page.screenshot({
      path: "test-results/m5-anthropic-credential-dialog.png",
      fullPage: true,
    });
    await expect
      .poll(() => readFile(credentialPath, "utf8"))
      .not.toContain(apiKey);
    expect(
      await page.evaluate(
        (secret) =>
          Object.keys(localStorage).some((key) =>
            localStorage.getItem(key)?.includes(secret),
          ),
        apiKey,
      ),
    ).toBe(false);

    await page.getByRole("button", { name: /关闭|Close/u }).click();
    await page.getByRole("button", { name: /Claude API Key/u }).click();
    await expect(page.getByTestId("anthropic-credential-status")).toHaveText(
      /已配置|Configured/u,
    );
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByTestId("anthropic-credential-delete").click();
    await expect(page.getByTestId("anthropic-credential-status")).toHaveText(
      /未配置|Not configured/u,
    );
    expect(await readFile(credentialPath, "utf8")).not.toContain(apiKey);
  } finally {
    await application.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("persists custom themes and local background images", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "author-copilot-e2e-"));
  const backgroundPath = join(temporaryRoot, "background.png");
  await writeFile(
    backgroundPath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const application = await launchApplication(temporaryRoot);

  try {
    const { center: page } = await enterWorkspace(application);
    await page
      .getByRole("button", { name: /主题设置|Theme settings/u })
      .click();
    await page.getByRole("button", { name: /晨曦|Dawn/u }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dawn");
    await page.getByRole("button", { name: /自定义|Custom/u }).click();
    await page
      .locator('.color-fields input[type="color"]')
      .first()
      .fill("#e3bf00");
    await page
      .locator('.background-upload input[type="file"]')
      .setInputFiles(backgroundPath);
    await expect(page.locator(".background-preview img")).toBeVisible();
    await page.locator('.background-controls input[type="range"]').fill("38");
    await page.getByRole("button", { name: /关闭|Close/u }).click();

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "custom");
    await expect(page.locator("html")).toHaveAttribute(
      "data-has-background",
      "true",
    );
    const themeTokens = await page.evaluate(() => {
      const root = document.documentElement;
      const primaryButton = document.querySelector<HTMLElement>(
        ".works-actions .button.primary",
      );
      const avatar = document.querySelector<HTMLElement>(
        ".center-profile-avatar",
      );
      if (primaryButton === null || avatar === null) return undefined;
      const rootStyle = root.style;
      const primaryStyle = getComputedStyle(primaryButton);
      return {
        accent: rootStyle.getPropertyValue("--accent"),
        accentGradient: rootStyle.getPropertyValue("--accent-gradient"),
        avatarBackground: getComputedStyle(avatar).backgroundImage,
        onAccent: rootStyle.getPropertyValue("--on-accent"),
        primaryBackground: primaryStyle.backgroundImage,
      };
    });
    expect(themeTokens).toBeDefined();
    expect(themeTokens?.accent).toBe("#e3bf00");
    expect(themeTokens?.accentGradient).toContain("#e3bf00");
    expect(themeTokens?.onAccent).toBe("#17201d");
    expect(themeTokens?.primaryBackground).toBe(themeTokens?.avatarBackground);
    await expect
      .poll(() =>
        page
          .locator(".works-actions .button.primary")
          .evaluate((element) => getComputedStyle(element).color),
      )
      .toBe("rgb(23, 32, 29)");
    await expect
      .poll(() =>
        page
          .locator(".filter-tabs button.active")
          .evaluate((element) => getComputedStyle(element).color),
      )
      .toBe("rgb(227, 191, 0)");
    const visibility = await page.evaluate(() => {
      const value = localStorage.getItem("author-copilot.theme-settings");
      return value === null
        ? undefined
        : (JSON.parse(value) as { backgroundVisibility?: number })
            .backgroundVisibility;
    });
    expect(visibility).toBe(38);

    await page
      .getByRole("button", { name: /主题设置|Theme settings/u })
      .click();
    await page.getByRole("button", { name: /移除图片|Remove image/u }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-has-background",
      "false",
    );
    await page.getByRole("button", { name: /晨曦|Dawn/u }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dawn");
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue("--accent-gradient"),
        ),
      )
      .toBe("");
    await page.getByRole("button", { name: /自定义|Custom/u }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "custom");
  } finally {
    await application.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("runs the native Agent SDK through controlled tools, keeps a version, and cancels/restores partial edits", async () => {
  test.setTimeout(120_000);
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "author-copilot-agent-e2e-"),
  );
  const projectTitle = "Agent E2E 中文";
  const relativePath = "第一卷/第一章/01-正文.md";
  const projectRoot = join(temporaryRoot, projectTitle);
  const documentPath = join(projectRoot, relativePath);
  let baseline = "任务前的草稿。";
  let replacement = "任务前的草稿。Agent 补充了雨夜。";
  let holdAfterWrite = false;
  let toolCalls = 0;
  const bodies: string[] = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      raw += chunk;
    });
    request.on("end", () => {
      if (
        !request.url?.includes("/messages") ||
        request.url.includes("count_tokens")
      ) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ input_tokens: 10 }));
        return;
      }
      bodies.push(raw);
      const body = JSON.parse(raw) as {
        stream?: boolean;
        messages?: unknown[];
      };
      const hasResult = JSON.stringify(body.messages).includes('"tool_result"');
      if (hasResult && holdAfterWrite) return;
      const block = hasResult
        ? { type: "text", text: "已完成本次受控改稿。" }
        : {
            type: "tool_use",
            id: `toolu_agent_${++toolCalls}`,
            name: "mcp__author_copilot__write_text",
            input: {
              relativePath,
              expectedHash: createHash("sha256").update(baseline).digest("hex"),
              content: replacement,
            },
          };
      const message = {
        id: `msg_agent_${toolCalls}`,
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [block],
        stop_reason: hasResult ? "end_turn" : "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      };
      if (!body.stream) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(message));
        return;
      }
      const events = [
        {
          type: "message_start",
          message: {
            ...message,
            content: [],
            stop_reason: null,
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: hasResult
            ? { type: "text", text: "" }
            : { ...block, input: {} },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: hasResult
            ? { type: "text_delta", text: "已完成本次受控改稿。" }
            : {
                type: "input_json_delta",
                partial_json: JSON.stringify(block.input),
              },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: message.stop_reason, stop_sequence: null },
          usage: { output_tokens: 20 },
        },
        { type: "message_stop" },
      ];
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        events
          .map(
            (event) =>
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          )
          .join(""),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address !== null && typeof address !== "string");
  let application = await launchApplication(temporaryRoot, {
    AUTHOR_COPILOT_E2E_AGENT_BASE_URL: `http://127.0.0.1:${address.port}`,
    AUTHOR_COPILOT_E2E_CREDENTIAL_ENCRYPTION: "1",
  });
  try {
    const { center } = await enterWorkspace(application);
    await center.getByRole("button", { name: /Claude API Key/u }).click();
    await center
      .getByTestId("anthropic-api-key")
      .fill("sk-ant-api03-agent-e2e");
    await center.getByTestId("anthropic-credential-save").click();
    await center.getByRole("button", { name: /关闭|Close/u }).click();
    await center.getByRole("button", { name: /新建小说|New novel/u }).click();
    await center.getByTestId("project-name").fill(projectTitle);
    await center.getByTestId("project-dialog-submit").click();
    const page = await rendererPage(application, "project");
    await page.getByRole("button", { name: "01-正文", exact: true }).click();
    await page.getByTestId("document-editor").fill(baseline);
    await page.getByTestId("save-document").click();
    await expect(
      page.getByText(/已保存|Saved/u, { exact: true }),
    ).toBeVisible();
    // Startup must initialize Git without committing this existing draft.
    await openAssistant(page, "agent");
    await page.getByTestId("agent-prompt").fill("加强雨夜描写。");
    await expect(page.getByTestId("agent-start")).toBeDisabled();
    expect(bodies).toHaveLength(0);
    await page.getByTestId("agent-authorize").check();
    await page.getByTestId("agent-start").click();
    await expect(page.getByTestId("agent-outcome")).toContainText(
      /任务完成|Task completed/u,
      { timeout: 45_000 },
    );
    expect(await readFile(documentPath, "utf8")).toBe(replacement);
    await expect(page.getByTestId("agent-before")).toContainText(baseline);
    await expect(page.getByTestId("agent-after")).toContainText(replacement);
    const refsBefore = await execFileAsync("git", [
      "-C",
      projectRoot,
      "for-each-ref",
      "refs/author-copilot/tasks/",
    ]);
    expect(refsBefore.stdout).toBe("");
    await page.screenshot({ path: "test-results/m6-agent-review.png" });
    await page.getByTestId("agent-retain").click();
    await expect(page.getByTestId("agent-prompt")).toBeVisible();
    const refs = await execFileAsync("git", [
      "-C",
      projectRoot,
      "for-each-ref",
      "--format=%(objectname)",
      "refs/author-copilot/tasks/",
    ]);
    expect(refs.stdout.trim()).toMatch(/^[a-f0-9]{40,64}$/u);
    const savedVersion = refs.stdout.trim();
    const diff = await execFileAsync("git", [
      "-C",
      projectRoot,
      "show",
      "--format=",
      savedVersion,
    ]);
    expect(diff.stdout).toContain("+任务前的草稿。Agent 补充了雨夜。");
    baseline = replacement;
    replacement += "未完成的追加。";
    holdAfterWrite = true;
    await page.getByTestId("agent-prompt").fill("继续修改，等待取消。");
    await page.getByTestId("agent-authorize").check();
    await page.getByTestId("agent-start").click();
    await expect
      .poll(() => readFile(documentPath, "utf8"), { timeout: 45_000 })
      .toBe(replacement);
    await closeWorkspacePanel(page);
    await expect(page.getByTestId("document-editor")).toHaveAttribute(
      "readonly",
      "",
    );
    await openAssistant(page, "agent");
    await page.getByTestId("agent-cancel").click();
    await expect(page.getByTestId("agent-outcome")).toContainText(
      /任务已取消|Task cancelled/u,
      { timeout: 15_000 },
    );
    await page.getByTestId("agent-restore").click();
    await expect.poll(() => readFile(documentPath, "utf8")).toBe(baseline);
    await expect(page.getByTestId("agent-prompt")).toBeVisible();
    expect(toolCalls).toBe(2);
    // Crash the Main process after a controlled write; the durable ledger must
    // still be recoverable and the native child must exit when its pipe closes.
    await page.getByTestId("agent-prompt").fill("模拟写入后的应用崩溃。");
    await page.getByTestId("agent-authorize").check();
    await page.getByTestId("agent-start").click();
    await expect
      .poll(() => readFile(documentPath, "utf8"), { timeout: 45_000 })
      .toBe(replacement);
    const mainPid = application.process().pid;
    let childPids: number[] = [];
    if (process.platform !== "win32") {
      const listing = await execFileAsync("ps", [
        "-axo",
        "pid=,ppid=,command=",
      ]);
      childPids = listing.stdout.split("\n").flatMap((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line);
        return match !== null &&
          Number(match[2]) === mainPid &&
          match[3]?.includes("/claude")
          ? [Number(match[1])]
          : [];
      });
      expect(childPids.length).toBeGreaterThan(0);
    }
    const exited = new Promise<void>((resolve) =>
      application.process().once("exit", () => resolve()),
    );
    application.process().kill("SIGKILL");
    await exited;
    for (const pid of childPids)
      await expect
        .poll(
          () => {
            try {
              process.kill(pid, 0);
              return false;
            } catch {
              return true;
            }
          },
          { timeout: 15_000 },
        )
        .toBe(true);
    application = await launchApplication(temporaryRoot);
    const recoveredCenter = await rendererPage(application, "center");
    await recoveredCenter
      .getByRole("button", {
        name: /打开作品.*Agent E2E|Open work.*Agent E2E/u,
      })
      .click();
    const recoveredPage = await rendererPage(application, "project");
    await openAssistant(recoveredPage, "agent");
    await expect(recoveredPage.getByTestId("agent-outcome")).toContainText(
      /原授权已失效|authorization has expired/u,
    );
    await expect(recoveredPage.getByTestId("agent-start")).toHaveCount(0);
    await recoveredPage.getByTestId("agent-restore").click();
    await expect.poll(() => readFile(documentPath, "utf8")).toBe(baseline);
    await expect(
      recoveredPage.getByTestId("agent-authorize"),
    ).not.toBeChecked();
  } finally {
    await application.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("persists manual writing statistics without counting reloads or IME preedit", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "author-writing-stats-"));
  let application = await launchApplication(temporaryRoot);
  const title = "写作统计验收";
  try {
    const { center } = await enterWorkspace(application);
    await center.getByRole("button", { name: /新建小说|New novel/u }).click();
    await center.getByTestId("project-name").fill(title);
    await center.getByTestId("project-dialog-submit").click();
    let page = await rendererPage(application, "project");
    const secondPath = join(
      temporaryRoot,
      title,
      "第一卷",
      "第一章",
      "02-已有.md",
    );
    await writeFile(secondPath, "外部已有正文不计入统计。", "utf8");
    await page.reload();
    await page.getByRole("button", { name: "01-正文", exact: true }).click();
    let editor = page.getByTestId("document-editor");
    const baseline = [...(await editor.inputValue()).replace(/\s/gu, "")]
      .length;
    await expect(page.getByTestId("writing-today")).toHaveText("0");
    await editor.fill("雨夜");
    await expect(page.getByTestId("writing-today")).toHaveText(
      String(2 - baseline),
    );
    await editor.press("End");
    await editor.pressSequentially("abc");
    await expect(page.getByTestId("writing-today")).toHaveText(
      String(5 - baseline),
    );
    await expect(page.getByTestId("writing-rate")).not.toHaveText("0");
    await editor.press("ControlOrMeta+z");
    await expect(page.getByTestId("writing-today")).toHaveText(
      String(4 - baseline),
    );
    await editor.press("ControlOrMeta+Shift+z");
    await expect(page.getByTestId("writing-today")).toHaveText(
      String(5 - baseline),
    );

    // Drive Chromium's IME path, including provisional input and commit.
    await editor.press("End");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", {
      text: "zhong",
      selectionStart: 5,
      selectionEnd: 5,
    });
    await expect(editor).toHaveValue("雨夜abczhong");
    await expect(page.getByTestId("writing-today")).toHaveText(
      String(5 - baseline),
    );
    await cdp.send("Input.insertText", { text: "中" });
    await expect(page.getByTestId("writing-today")).toHaveText(
      String(6 - baseline),
    );

    await editor.press("ControlOrMeta+z");
    await expect(editor).toHaveValue("雨夜abc");
    await expect(page.getByTestId("writing-today")).toHaveText(
      String(5 - baseline),
    );
    await editor.press("ControlOrMeta+Shift+z");
    await expect(page.getByTestId("writing-today")).toHaveText(
      String(6 - baseline),
    );
    await cdp.detach();

    await editor.press("ControlOrMeta+s");
    await expect(page.getByTestId("save-document")).toBeDisabled();
    await expect(page.getByTestId("writing-statistics")).toHaveAttribute(
      "data-state",
      "saved",
    );
    await page.getByRole("button", { name: "02-已有", exact: true }).click();
    await expect(editor).toHaveValue("外部已有正文不计入统计。");
    await expect(page.getByTestId("writing-today")).toHaveText(
      String(6 - baseline),
    );
    await expect(page.getByTestId("writing-rate")).toHaveText("0");
    await application.close();
    application = await launchApplication(temporaryRoot);
    const nextCenter = await rendererPage(application, "center");
    await nextCenter
      .getByRole("button", {
        name: /打开作品.*写作统计验收|Open work.*写作统计验收/u,
      })
      .click();
    page = await rendererPage(application, "project");
    await page.getByRole("button", { name: "01-正文", exact: true }).click();
    editor = page.getByTestId("document-editor");
    await expect(editor).toHaveValue("雨夜abc中");
    await expect(page.getByTestId("writing-today")).toHaveText(
      String(6 - baseline),
    );
    await expect(page.getByTestId("writing-rate")).toHaveText("0");
    await page.screenshot({ path: "test-results/writing-statistics.png" });
    await openAssistant(page);
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(880, 700),
    );
    await expect(page.getByTestId("writing-today")).toBeVisible();
    await expect(page.getByTestId("writing-rate")).toBeVisible();
    await page.screenshot({
      path: "test-results/writing-statistics-narrow.png",
    });
  } finally {
    await application.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("keeps AI beside the manuscript and supports writing toolbar operations", async () => {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "author-copilot-toolbar-"),
  );
  const application = await launchApplication(temporaryRoot);
  try {
    const { center } = await enterWorkspace(application);
    await center.getByRole("button", { name: /新建小说|New novel/u }).click();
    await center.getByTestId("project-name").fill("雨夜来信");
    await center.getByTestId("project-dialog-submit").click();
    const page = await rendererPage(application, "project");
    await writeFile(
      join(temporaryRoot, "雨夜来信", "第一卷", "第一章", "02-来信.md"),
      "第二封信。",
      "utf8",
    );
    await page.reload();
    await page.getByRole("button", { name: "01-正文", exact: true }).click();
    const editor = page.getByTestId("document-editor");
    const original =
      "雨夜，林舟走进旧书店。\n柜台上放着一封没有署名的信。\n\n雨夜的钟声从远处传来。";
    await editor.fill(original);
    await page
      .getByRole("button", { name: /一键排版|Format/u, exact: true })
      .click();
    const formatted =
      "　　雨夜，林舟走进旧书店。\n\n　　柜台上放着一封没有署名的信。\n\n　　雨夜的钟声从远处传来。";
    await expect(editor).toHaveValue(formatted);
    await page.getByRole("button", { name: /撤销|Undo/u, exact: true }).click();
    await expect(editor).toHaveValue(original);
    await page.getByRole("button", { name: /重做|Redo/u, exact: true }).click();
    await expect(editor).toHaveValue(formatted);
    await editor.press("ControlOrMeta+z");
    await expect(editor).toHaveValue(original);
    await editor.press("ControlOrMeta+Shift+z");
    await expect(editor).toHaveValue(formatted);

    const beforeFind = await editor.boundingBox();
    await page
      .getByRole("button", { name: /查找替换|Find & replace/u })
      .click();
    const findWindow = page.getByRole("dialog", {
      name: /查找替换|Find & replace/u,
    });
    await expect(findWindow).toBeVisible();
    expect(await editor.boundingBox()).toEqual(beforeFind);
    const initialFind = await findWindow.boundingBox();
    const dragHandle = findWindow.getByRole("button", {
      name: /移动查找窗口|Move find window/u,
    });
    const handleBounds = await dragHandle.boundingBox();
    assert(initialFind && handleBounds);
    const dragX = handleBounds.x + 60;
    const dragY = handleBounds.y + handleBounds.height / 2;
    await page.mouse.move(dragX, dragY);
    await page.mouse.down();
    await page.mouse.move(dragX - 150, dragY + 130, { steps: 8 });
    await page.mouse.up();
    const movedFind = await findWindow.boundingBox();
    assert(movedFind);
    expect(movedFind.x).toBeCloseTo(initialFind.x - 150, 0);
    expect(movedFind.y).toBeCloseTo(initialFind.y + 130, 0);
    await page.screenshot({ path: "test-results/draggable-find-replace.png" });
    await page
      .getByRole("textbox", {
        name: /查找（区分大小写）|Find \(case-sensitive\)/u,
      })
      .fill("雨夜");
    await expect(page.getByRole("search")).toContainText("1 / 2");
    await page.getByRole("button", { name: /下一个匹配|Next match/u }).click();
    await expect
      .poll(() =>
        editor.evaluate((element: HTMLTextAreaElement) =>
          element.value.slice(element.selectionStart, element.selectionEnd),
        ),
      )
      .toBe("雨夜");
    await page
      .getByRole("textbox", { name: /替换|Replace/u, exact: true })
      .fill("$&晨雾");
    await page
      .getByRole("button", { name: /全部替换|Replace all/u, exact: true })
      .click();
    await expect(editor).toHaveValue(formatted.split("雨夜").join("$&晨雾"));
    await page.getByRole("button", { name: /撤销|Undo/u, exact: true }).click();
    await expect(editor).toHaveValue(formatted);
    await findWindow.getByRole("button", { name: /关闭|Close/u }).click();
    await expect(findWindow).toBeHidden();
    await editor.press("ControlOrMeta+f");
    await expect(findWindow).toBeVisible();
    expect(await findWindow.boundingBox()).toEqual(movedFind);
    await page
      .getByRole("textbox", {
        name: /查找（区分大小写）|Find \(case-sensitive\)/u,
      })
      .press("Escape");
    await expect(findWindow).toBeHidden();

    await page.getByRole("button", { name: /字体|Font/u, exact: true }).click();
    await page.getByRole("combobox", { name: /字号|Size/u }).selectOption("20");
    await expect(editor).toHaveCSS("font-size", "20px");
    await page.getByRole("button", { name: /字体|Font/u, exact: true }).click();
    await openAssistant(page);
    const dock = page.getByTestId("assistant-dock");
    await expect(editor).toBeVisible();
    await expect(dock).toBeVisible();
    const editorBounds = await editor.boundingBox();
    const dockBounds = await dock.boundingBox();
    assert(editorBounds && dockBounds);
    expect(editorBounds.x + editorBounds.width).toBeLessThanOrEqual(
      dockBounds.x + 1,
    );
    expect(editorBounds.width).toBeGreaterThan(250);
    await page.getByTestId("ai-chat-input").fill("帮我构思这封信的来历");
    await closeWorkspacePanel(page);
    await expect(dock).toBeHidden();
    await openAssistant(page);
    await expect(page.getByTestId("ai-chat-input")).toHaveValue(
      "帮我构思这封信的来历",
    );
    await expect(editor).toHaveValue(formatted);
    await editor.press("ControlOrMeta+s");
    await expect(page.getByTestId("save-document")).toBeDisabled();
    await page
      .getByRole("button", { name: /历史记录|History/u, exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(/历史记录|History/u);
    await closeWorkspacePanel(page);
    await expect(editor).toHaveValue(formatted);
    await expect(dock).toBeVisible();
    await page.screenshot({ path: "test-results/editor-sidebar-toolbar.png" });
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(880, 700),
    );
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(880);
    const narrowEditor = await editor.boundingBox();
    const narrowDock = await dock.boundingBox();
    assert(narrowEditor && narrowDock);
    expect(narrowEditor.width).toBeGreaterThan(250);
    expect(narrowEditor.x + narrowEditor.width).toBeLessThanOrEqual(
      narrowDock.x + 1,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: "test-results/editor-sidebar-narrow.png" });
    await editor.press("ControlOrMeta+f");
    await expect(findWindow).toBeVisible();
    await dragHandle.focus();
    for (let index = 0; index < 30; index += 1)
      await dragHandle.press("Shift+ArrowRight");
    const clampedFind = await findWindow.boundingBox();
    assert(clampedFind);
    expect(clampedFind.x + clampedFind.width).toBeLessThanOrEqual(872);
    await findWindow.getByRole("button", { name: /关闭|Close/u }).click();
    // Changing the chapter does not close the assistant or lose its draft.
    await page.getByRole("button", { name: "02-来信", exact: true }).click();
    await expect(dock).toBeVisible();
    await expect(page.getByTestId("ai-chat-input")).toHaveValue(
      "帮我构思这封信的来历",
    );
    await expect(
      page.getByRole("button", { name: /撤销|Undo/u, exact: true }),
    ).toBeDisabled();
  } finally {
    await application.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

for (const connection of ["custom", "platform"] as const) {
  test(`uses ${connection} Anthropic settings for chat, proposal and native Agent`, async () => {
    test.skip(
      connection === "platform" && process.env.PLATFORM_INTEGRATION !== "1",
      "Requires the isolated Mongo replica set, Redis and a built API.",
    );
    test.setTimeout(120000);
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), `ac-${connection}-flow-`),
    );
    const projectTitle = "供应商联调";
    const relativePath = "第一卷/第一章/01-正文.md";
    const documentPath = join(temporaryRoot, projectTitle, relativePath);
    const requests: { model: string; key: string }[] = [];
    let mode: "chat" | "proposal" | "agent" = "chat";
    const mock = createServer(async (request, response) => {
      let raw = "";
      for await (const chunk of request) raw += String(chunk);
      if (request.url?.startsWith("/v1/models")) {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            data: [
              {
                id: "claude-sonnet-4-6",
                display_name: "Mock Claude",
                type: "model",
                created_at: "2026-01-01T00:00:00Z",
              },
            ],
            has_more: false,
            first_id: "claude-sonnet-4-6",
            last_id: "claude-sonnet-4-6",
          }),
        );
        return;
      }
      if (request.url?.includes("count_tokens")) {
        response.setHeader("content-type", "application/json");
        response.end('{"input_tokens":20}');
        return;
      }
      if (!request.url?.includes("/messages")) {
        response.writeHead(404);
        response.end();
        return;
      }
      const body = JSON.parse(raw) as {
        model: string;
        stream?: boolean;
        messages: unknown[];
      };
      requests.push({
        model: body.model,
        key: String(request.headers["x-api-key"]),
      });
      const baseline = await readFile(documentPath, "utf8");
      const hasResult =
        mode === "agent" &&
        JSON.stringify(body.messages).includes('"tool_result"');
      const block =
        mode === "chat" || hasResult
          ? {
              type: "text",
              text:
                mode === "chat"
                  ? "这段雨夜描写可以加强声音细节。"
                  : "已完成本次受控改稿。",
            }
          : {
              type: "tool_use",
              id: `toolu_${requests.length}`,
              name:
                mode === "proposal"
                  ? "propose_project_changes"
                  : "mcp__author_copilot__write_text",
              input:
                mode === "proposal"
                  ? {
                      summary: "加强雨夜",
                      files: [
                        {
                          relativePath,
                          baselineHash: createHash("sha256")
                            .update(baseline)
                            .digest("hex"),
                          edits: [
                            {
                              changeId: "rain",
                              startOffset: 0,
                              endOffset: 2,
                              expectedText: "雨夜",
                              replacementText: "暴雨之夜",
                            },
                          ],
                        },
                      ],
                    }
                  : {
                      relativePath,
                      expectedHash: createHash("sha256")
                        .update(baseline)
                        .digest("hex"),
                      content: baseline + "远处传来钟声。",
                    },
            };
      const message = {
        id: `msg_${requests.length}`,
        type: "message",
        role: "assistant",
        model: body.model,
        content: [block],
        stop_reason: block.type === "text" ? "end_turn" : "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 10 },
      };
      if (!body.stream) {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(message));
        return;
      }
      const events = [
        {
          type: "message_start",
          message: {
            ...message,
            content: [],
            stop_reason: null,
            usage: { input_tokens: 20, output_tokens: 0 },
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block:
            block.type === "text"
              ? { type: "text", text: "" }
              : { ...block, input: {} },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta:
            block.type === "text"
              ? { type: "text_delta", text: block.text }
              : {
                  type: "input_json_delta",
                  partial_json: JSON.stringify(block.input),
                },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: message.stop_reason, stop_sequence: null },
          usage: { output_tokens: 10 },
        },
        { type: "message_stop" },
      ];
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        events
          .map(
            (event) =>
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          )
          .join(""),
      );
    });
    await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
    const mockAddress = mock.address();
    assert(mockAddress && typeof mockAddress !== "string");
    let apiProcess: ReturnType<typeof execFile> | undefined;
    let platformURL: string | undefined;
    const apiEnvironment = {
      ...inheritedEnvironment,
      NODE_ENV: "development",
      AUTH_SIGNING_SECRET: "e2e-platform-signing-secret-not-for-production",
      E2E_UPSTREAM_KEY: "platform-upstream-key",
    };
    if (connection === "platform") {
      const configPath = join(temporaryRoot, "relay.json");
      await writeFile(
        configPath,
        JSON.stringify({
          baseURL: `http://127.0.0.1:${mockAddress.port}`,
          apiKeyEnv: "E2E_UPSTREAM_KEY",
          defaultModel: "claude-sonnet-4-6",
          models: [
            {
              id: "claude-sonnet-4-6",
              name: "Mock Claude",
              maxOutputTokens: 32768,
              price: {
                input: 1000000,
                output: 2000000,
                cacheRead: 100000,
                cacheWrite: 2000000,
              },
            },
          ],
        }),
      );
      const moduleURL = new URL(
        `file://${resolve(import.meta.dirname, "../../api/dist/application.js")}`,
      ).href;
      const script = `import {createApplication} from ${JSON.stringify(moduleURL)}; const app = await createApplication(); await app.listen(0, '127.0.0.1'); process.stdout.write('M7_PORT:'+app.getHttpServer().address().port+'\\n'); process.on('SIGTERM',()=>{void app.close().then(()=>process.exit(0));});`;
      apiProcess = execFile(
        process.execPath,
        ["--input-type=module", "-e", script],
        { env: { ...apiEnvironment, RELAY_CONFIG: configPath } },
      );
      let output = "";
      apiProcess.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      apiProcess.stderr?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      await expect
        .poll(() => output.match(/M7_PORT:(\d+)/u)?.[1], { timeout: 15000 })
        .toBeTruthy();
      platformURL = `http://127.0.0.1:${output.match(/M7_PORT:(\d+)/u)![1]}`;
    }
    const application = await launchApplication(temporaryRoot, {
      AUTHOR_COPILOT_E2E_CREDENTIAL_ENCRYPTION: "1",
      ...(platformURL ? { AUTHOR_COPILOT_PLATFORM_URL: platformURL } : {}),
    });
    try {
      const { center, shell } = await enterWorkspace(application);
      await center.getByRole("button", { name: /Claude API Key/u }).click();
      if (connection === "custom") {
        await center.getByTestId("provider-list").selectOption("new");
        await center
          .getByRole("textbox", { name: /供应商名称|Provider name/u })
          .fill("Mock provider");
        await center
          .getByTestId("provider-base-url")
          .fill(`http://127.0.0.1:${mockAddress.port}/v1`);
        await center
          .getByTestId("anthropic-api-key")
          .fill("custom-provider-key");
        await center.getByTestId("anthropic-credential-save").click();
        await expect(
          center.getByTestId("anthropic-credential-status"),
        ).toContainText(/已配置|Configured/u);
        await center
          .getByRole("button", { name: /刷新模型|Refresh models/u })
          .click();
        await expect(center.getByRole("status")).toContainText(
          /模型列表已更新|Model list updated/u,
        );
        await center.getByTestId("provider-model").fill("claude-sonnet-4-6");
        await center.getByRole("button", { name: /^(使用|Use)$/u }).click();
        await expect(center.getByRole("status")).toContainText(
          /AI 连接已更新|AI connection updated/u,
        );
      } else {
        await center
          .getByRole("button", { name: /平台账号|Platform account/u })
          .click();
        await center
          .getByRole("combobox", { name: /账号操作|Account action/u })
          .selectOption("register");
        const email = `desktop-${randomUUID()}@example.com`;
        await center.getByTestId("account-email").fill(email);
        await center
          .getByTestId("account-password")
          .fill("desktop-platform-test-123");
        await center.getByTestId("account-submit").click();
        await expect(
          center.getByRole("dialog").getByText(email, { exact: true }),
        ).toBeVisible();
        await expect(
          center.getByText(
            /在线充值暂未开放|Online recharge is not available/u,
          ),
        ).toBeVisible();
        await execFileAsync(
          process.execPath,
          [
            resolve(
              import.meta.dirname,
              "../../api/dist/platform/dev-credit.js",
            ),
            email,
            "1000000",
          ],
          { env: apiEnvironment },
        );
        await center
          .getByRole("button", { name: /刷新余额|Refresh balance/u })
          .click();
        await expect(
          center.getByText(/可用余额.*1\.000000|Available balance.*1\.000000/u),
        ).toBeVisible();
      }
      await center.getByRole("button", { name: /^(关闭|Close)$/u }).click();
      await center.getByRole("button", { name: /新建小说|New novel/u }).click();
      await center.getByTestId("project-name").fill(projectTitle);
      await center.getByTestId("project-dialog-submit").click();
      const page = await rendererPage(application, "project");
      await page.getByRole("button", { name: "01-正文", exact: true }).click();
      await page.getByTestId("document-editor").fill("雨夜，她开门。");
      await page.getByTestId("save-document").click();
      await expect(page.getByTestId("save-document")).toBeDisabled();
      await openAssistant(page);
      if (connection === "platform")
        await page
          .getByRole("combobox", { name: /AI 连接|AI connection/u })
          .selectOption("platform");
      await page.getByTestId("ai-chat-input").fill("帮我分析开场");
      await page.getByTestId("ai-chat-send").click();
      await expect(page.getByTestId("ai-chat-panel")).toContainText(
        "这段雨夜描写可以加强声音细节。",
      );
      mode = "proposal";
      await page.getByTestId("ai-chat-input").fill("加强雨夜");
      await page.getByTestId("ai-proposal-create").click();
      await expect(page.getByTestId("proposal-review")).toBeVisible();
      await page.getByTestId("proposal-apply").click();
      await expect(page.getByTestId("document-editor")).toHaveValue(
        "暴雨之夜，她开门。",
      );
      mode = "agent";
      await openAssistant(page, "agent");
      await page.getByTestId("agent-prompt").fill("补充钟声");
      await page.getByTestId("agent-authorize").check();
      await page.getByTestId("agent-start").click();
      await expect(page.getByTestId("agent-outcome")).toContainText(
        /任务完成|Task completed/u,
        { timeout: 60000 },
      );
      expect(await readFile(documentPath, "utf8")).toBe(
        "暴雨之夜，她开门。远处传来钟声。",
      );
      await page.getByTestId("agent-retain").click();
      await expect(page.getByTestId("agent-prompt")).toBeVisible();
      expect(requests.length).toBeGreaterThanOrEqual(4);
      expect(
        requests.every(
          (request) =>
            request.model === "claude-sonnet-4-6" &&
            request.key ===
              (connection === "custom"
                ? "custom-provider-key"
                : "platform-upstream-key"),
        ),
      ).toBe(true);
      if (connection === "platform") {
        await page
          .getByTestId("assistant-dock")
          .getByRole("button", { name: /AI 设置|AI settings/u })
          .click();
        await page
          .getByRole("button", { name: /平台账号|Platform account/u })
          .click();
        await expect(page.locator(".account-ledger")).toContainText(
          /已结算|Settled/u,
        );
        expect(
          await page.evaluate(() =>
            JSON.stringify(
              (window as unknown as { authorCopilot: AuthorCopilotApi })
                .authorCopilot,
            ),
          ),
        ).not.toContain("platform-upstream-key");
        await page.screenshot({ path: "test-results/m7-platform-account.png" });
        await page
          .getByRole("dialog")
          .getByRole("button", { name: /^(关闭|Close)$/u })
          .click();
        await shell
          .locator(".app-tabs")
          .getByRole("tab", { name: /作家中心|Writer center/u })
          .click();
        await center.getByRole("button", { name: /退出|Log out/u }).click();
        await expect(shell.getByTestId("continue-local")).toBeVisible();
        const signedOut = await shell.evaluate(() =>
          (
            window as unknown as { authorCopilot: AuthorCopilotApi }
          ).authorCopilot.aiSettings({ action: "state" }),
        );
        expect(signedOut.ok && signedOut.state?.user).toBeNull();
      }
    } finally {
      await application.close();
      if (apiProcess) {
        apiProcess.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          if (apiProcess?.exitCode !== null) resolve();
          else apiProcess.once("exit", () => resolve());
        });
      }
      mock.closeAllConnections();
      await new Promise<void>((resolve) => mock.close(() => resolve()));
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
}
