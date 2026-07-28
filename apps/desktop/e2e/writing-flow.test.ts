import assert from "node:assert/strict";
import { execFile } from "node:child_process";
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

const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);
const execFileAsync = promisify(execFile);

async function signIn(page: Page): Promise<void> {
  await page.getByLabel(/邮箱|Email/u).fill("writer@example.com");
  await page.getByLabel(/密码|Password/u).fill("writer123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByText(/我的作品|My works/u)).toBeVisible();
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

test("creates, edits, saves, and protects an externally changed novel", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "author-copilot-e2e-"));
  const projectTitle = "E2E 写作项目";
  const projectRoot = join(temporaryRoot, projectTitle);
  const documentPath = join(projectRoot, "第一卷", "第一章", "01-正文.md");
  const application = await launchApplication(temporaryRoot);

  try {
    const page = await application.firstWindow();
    await signIn(page);
    await page.getByRole("button", { name: /新建小说|New novel/u }).click();
    await page.getByTestId("project-name").fill(projectTitle);
    await page.getByTestId("project-dialog-submit").click();

    await page.getByRole("button", { name: "01-正文" }).click();
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
    const page = await application.firstWindow();
    await signIn(page);
    await page
      .getByRole("button", { name: /新建剧本|New screenplay/u })
      .click();
    await page.getByTestId("project-name").fill(projectTitle);
    await page.getByTestId("project-dialog-submit").click();
    await page.getByRole("button", { name: "01-第一场" }).click();
    await expect(page.getByTestId("document-editor")).toHaveValue("");
    await assert.doesNotReject(
      lstat(join(temporaryRoot, projectTitle, "第一幕", "01-第一场.md")),
    );
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
    const page = await application.firstWindow();
    await signIn(page);
    await page
      .getByRole("button", { name: /导入 Markdown|Import Markdown/u })
      .click();
    await page
      .getByRole("button", { name: /选择文件夹|Choose folder/u })
      .click();
    await expect(page.getByText("第一卷")).toBeVisible();
    await expect(page.getByText("散落 笔记")).toBeVisible();
    await assert.rejects(lstat(metadataPath), { code: "ENOENT" });

    await page.getByTestId("project-dialog-submit").click();
    await page.getByRole("button", { name: "01-开场" }).click();
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
    const page = await application.firstWindow();
    await signIn(page);
    await page
      .getByRole("button", { name: /主题设置|Theme settings/u })
      .click();
    await page.getByRole("button", { name: /晨曦|Dawn/u }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dawn");
    await page.getByRole("button", { name: /自定义|Custom/u }).click();
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
  } finally {
    await application.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
