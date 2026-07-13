import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow, session } from "electron";

import { DesktopDomainEvents } from "./domain-events.js";
import { registerIpcHandlers } from "./ipc.js";
import {
  createFixedProjectDirectoryPicker,
  createProjectDirectoryPicker,
} from "./project-dialogs.js";
import { ProjectService, RegistryStore } from "./project/index.js";
import {
  denyAllPermissions,
  installProductionCsp,
  lockDownWindow,
} from "./security-policy.js";
import { createWindowOptions } from "./window-options.js";

let mainWindow: BrowserWindow | undefined;
const smokeMode = process.env.AUTHOR_COPILOT_ELECTRON_SMOKE === "1";
const e2eMode = !app.isPackaged && process.env.AUTHOR_COPILOT_E2E === "1";

if (e2eMode && process.env.AUTHOR_COPILOT_E2E_USER_DATA !== undefined) {
  app.setPath("userData", process.env.AUTHOR_COPILOT_E2E_USER_DATA);
}

function rendererTarget(): {
  readonly url: string;
  readonly isDevelopment: boolean;
} {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;

  if (developmentUrl !== undefined) {
    return { url: new URL(developmentUrl).href, isDevelopment: true };
  }

  const rendererHtml = join(import.meta.dirname, "../renderer/index.html");
  return { url: pathToFileURL(rendererHtml).href, isDevelopment: false };
}

async function createMainWindow(): Promise<void> {
  const target = rendererTarget();
  mainWindow = new BrowserWindow(
    createWindowOptions(join(import.meta.dirname, "../preload/index.cjs")),
  );

  lockDownWindow(mainWindow);
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  await mainWindow.loadURL(target.url);
}

app.whenReady().then(async () => {
  const target = rendererTarget();
  const domainEvents = new DesktopDomainEvents();
  const projectService = new ProjectService({
    registry: new RegistryStore(app.getPath("userData")),
    publishEvent: domainEvents.publish,
  });

  denyAllPermissions(session.defaultSession);
  if (!target.isDevelopment) {
    installProductionCsp(session.defaultSession);
  }
  registerIpcHandlers(target.url, {
    projectService,
    directoryPicker:
      e2eMode && process.env.AUTHOR_COPILOT_E2E_DIRECTORY !== undefined
        ? createFixedProjectDirectoryPicker({
            createParent: process.env.AUTHOR_COPILOT_E2E_DIRECTORY,
            importSource:
              process.env.AUTHOR_COPILOT_E2E_IMPORT_SOURCE ??
              process.env.AUTHOR_COPILOT_E2E_DIRECTORY,
            copyDestination:
              process.env.AUTHOR_COPILOT_E2E_COPY_DESTINATION ??
              process.env.AUTHOR_COPILOT_E2E_DIRECTORY,
          })
        : createProjectDirectoryPicker(),
    ...(smokeMode
      ? {
          onRuntimeInfo: () => {
            console.log("AUTHOR_COPILOT_ELECTRON_SMOKE_READY");
            setImmediate(() => app.quit());
          },
        }
      : {}),
  });

  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
