import { BrowserWindow, dialog, type OpenDialogOptions } from "electron";

export interface ProjectDirectoryPicker {
  chooseCreateParent(): Promise<string | undefined>;
  chooseImportSource(): Promise<string | undefined>;
  chooseCopyDestination(): Promise<string | undefined>;
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
    chooseCreateParent: () =>
      chooseDirectory({
        title: "Choose where to create the project",
        buttonLabel: "Choose folder",
      }),
    chooseImportSource: () =>
      chooseDirectory({
        title: "Choose a Markdown project folder",
        buttonLabel: "Preview import",
      }),
    chooseCopyDestination: () =>
      chooseDirectory({
        title: "Choose where to copy the imported project",
        buttonLabel: "Copy project",
      }),
  };
}

export interface FixedProjectDirectories {
  readonly createParent: string;
  readonly importSource: string;
  readonly copyDestination: string;
}

export function createFixedProjectDirectoryPicker(
  directories: FixedProjectDirectories,
): ProjectDirectoryPicker {
  return {
    chooseCreateParent: async () => directories.createParent,
    chooseImportSource: async () => directories.importSource,
    chooseCopyDestination: async () => directories.copyDestination,
  };
}
