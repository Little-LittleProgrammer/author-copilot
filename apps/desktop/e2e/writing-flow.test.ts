import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
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

async function signIn(
  application: ElectronApplication,
): Promise<{ readonly center: Page; readonly shell: Page }> {
  const shell = await application.firstWindow();
  await expect(shell.locator(".app-tabs")).toHaveCount(0);
  await shell.getByLabel(/邮箱|Email/u).fill("writer@example.com");
  await shell.getByLabel(/密码|Password/u).fill("writer123");
  await shell.getByTestId("login-submit").click();
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
    const { center, shell } = await signIn(application);
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
    await page.getByRole("tab", { name: /变更审阅|Change review/u }).click();
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
    await page.getByRole("tab", { name: /正文|Content/u }).click();
    await expect(editor).toHaveValue("# 备选结局\n\n列车驶入晨光。\n");
    await page.getByRole("tab", { name: /变更审阅|Change review/u }).click();
    await branchSwitcher
      .getByRole("combobox", { name: /分支|Branch/u })
      .selectOption("main");
    await branchSwitcher
      .getByRole("button", { name: /切换分支|Switch branch/u })
      .click();
    await expect(branchSwitcher).toContainText(/分支已切换|Branch switched/u);
    await page.getByRole("tab", { name: /正文|Content/u }).click();
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
    const { center } = await signIn(application);
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

test("restores an Agent task from the change review without losing the task-start file", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "author-copilot-e2e-"));
  const projectTitle = "E2E 任务恢复";
  const application = await launchApplication(temporaryRoot);

  try {
    const { center } = await signIn(application);
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

    await page.getByRole("tab", { name: /变更审阅|Change review/u }).click();
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
    await page.getByRole("tab", { name: /正文|Content/u }).click();
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
    const { center, shell } = await signIn(application);
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
    const { center, shell } = await signIn(application);
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
    await expect(page.locator("body")).not.toContainText(/Markdown|\.md/u);

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
    await page.getByRole("tab", { name: /AI 对话|AI chat/u }).click();
    await expect(
      page.getByRole("region", { name: /AI 上下文|AI context/u }),
    ).toContainText("开场");
    await page.getByRole("tab", { name: /正文|Content/u }).click();

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
    const { center } = await signIn(application);
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

    await page.getByRole("tab", { name: /AI 对话|AI chat/u }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: /初始化|Initialize/u, exact: true })
      .click();
    await expect(page.getByText(/可用|Ready/u, { exact: true })).toBeVisible({
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
    const { center } = await signIn(application);
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
    const { center: page } = await signIn(application);
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
