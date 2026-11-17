import {
  BrowserWindow,
  dialog,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from "electron";
import { join } from "node:path";
import type { ProjectExportFormat } from "@author-copilot/contracts";

export interface ExportDestinationOptions {
  readonly fileName: string;
  readonly format: ProjectExportFormat;
  readonly locale: "zh-CN" | "en-US";
}

export interface ProjectDirectoryPicker {
  chooseExportDestination(
    options: ExportDestinationOptions,
  ): Promise<string | undefined>;
  chooseImportFile(): Promise<string | undefined>;
  chooseImportSource(): Promise<string | undefined>;
  chooseRestoreBackup?(options: {
    readonly locale: "zh-CN" | "en-US";
  }): Promise<string | undefined>;
  chooseBackupDestination?(options: {
    readonly locale: "zh-CN" | "en-US";
  }): Promise<string | undefined>;
}

async function chooseDirectory(
  options: Pick<OpenDialogOptions, "buttonLabel" | "title">,
): Promise<string | undefined> {
  const dialogOptions: OpenDialogOptions = {
    ...options,
    properties: ["openDirectory", "createDirectory"],
  };
  const owner = BrowserWindow.getFocusedWindow();
  const result =
    owner === null
      ? await dialog.showOpenDialog(dialogOptions)
      : await dialog.showOpenDialog(owner, dialogOptions);
  return result.canceled ? undefined : result.filePaths[0];
}

export function createProjectDirectoryPicker(): ProjectDirectoryPicker {
  return {
    chooseExportDestination: async ({ fileName, format, locale }) => {
      const chinese = locale === "zh-CN";
      const options: SaveDialogOptions = {
        title: chinese ? "导出作品" : "Export manuscript",
        buttonLabel: chinese ? "导出" : "Export",
        defaultPath: fileName,
        filters: [
          {
            name: { txt: "TXT", md: "Markdown", docx: "Word" }[format],
            extensions: [format],
          },
        ],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      };
      const owner = BrowserWindow.getFocusedWindow();
      const result = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options);
      return result.canceled ? undefined : result.filePath;
    },
    chooseImportFile: async () => {
      const options: OpenDialogOptions = {
        title: "Import TXT or Word document",
        buttonLabel: "Preview import",
        properties: ["openFile"],
        filters: [{ name: "TXT / Word", extensions: ["txt", "docx", "doc"] }],
      };
      const owner = BrowserWindow.getFocusedWindow();
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? undefined : result.filePaths[0];
    },
    chooseImportSource: () =>
      chooseDirectory({
        title: "Choose a Markdown project folder",
        buttonLabel: "Preview import",
      }),
    chooseRestoreBackup: ({ locale }) =>
      chooseDirectory({
        title:
          locale === "zh-CN"
            ? "选择作品备份文件夹"
            : "Choose an Author Copilot backup folder",
        buttonLabel:
          locale === "zh-CN" ? "恢复为独立作品" : "Restore as a new work",
      }),
    chooseBackupDestination: ({ locale }) =>
      chooseDirectory({
        title:
          locale === "zh-CN" ? "选择作品备份位置" : "Choose backup location",
        buttonLabel: locale === "zh-CN" ? "备份到这里" : "Back up here",
      }),
  };
}

export interface FixedProjectDirectories {
  readonly exportDirectory?: string;
  readonly importSource: string;
}

export function createFixedProjectDirectoryPicker(
  directories: FixedProjectDirectories,
): ProjectDirectoryPicker {
  return {
    chooseExportDestination: async ({ fileName }) =>
      join(directories.exportDirectory ?? directories.importSource, fileName),
    chooseImportSource: async () => directories.importSource,
    chooseImportFile: async () => directories.importSource,
    chooseRestoreBackup: async () => directories.importSource,
    chooseBackupDestination: async () =>
      directories.exportDirectory ?? directories.importSource,
  };
}
