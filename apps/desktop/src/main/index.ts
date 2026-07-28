import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow, session } from "electron";
import type { ProjectSummary } from "@author-copilot/contracts";

import { DesktopDomainEvents } from "./domain-events.js";
import { GitService } from "./git/index.js";
import { resolveGitRuntime } from "./git-runtime.js";
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
import { TabManager } from "./tabs/index.js";
import {
  createSecureWebPreferences,
  createWindowOptions,
} from "./window-options.js";

let mainWindow: BrowserWindow | undefined;
let tabManager: TabManager | undefined;
let quitRequested = false;
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

interface MainWindowOptions {
  readonly target: ReturnType<typeof rendererTarget>;
  readonly preloadPath: string;
  readonly projectService: ProjectService;
}

function projectSummary(
  project: Awaited<ReturnType<ProjectService["list"]>>[number],
): ProjectSummary {
  return {
    projectId: project.projectId,
    title: project.metadata.title,
    template: project.metadata.template,
    rootDisplayName: basename(project.rootPath),
  };
}

async function createMainWindow(options: MainWindowOptions): Promise<void> {
  mainWindow = new BrowserWindow(createWindowOptions(options.preloadPath));

  lockDownWindow(mainWindow);
  tabManager = new TabManager({
    window: mainWindow,
    rendererUrl: options.target.url,
    webPreferences: createSecureWebPreferences(options.preloadPath),
    resolveProject: async (projectId) => {
      const project = (await options.projectService.list()).find(
        (candidate) => candidate.projectId === projectId,
      );
      return project === undefined ? undefined : projectSummary(project);
    },
    ...(e2eMode ? { confirmDiscard: async () => true } : {}),
    afterConfirmedWindowClose: () => {
      if (quitRequested) setImmediate(() => app.quit());
    },
    afterCancelledWindowClose: () => {
      quitRequested = false;
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.once("closed", () => {
    tabManager?.dispose();
    tabManager = undefined;
    mainWindow = undefined;
  });

  await mainWindow.loadURL(options.target.url);
}

app.whenReady().then(async () => {
  const target = rendererTarget();
  const domainEvents = new DesktopDomainEvents();
  const projectService = new ProjectService({
    registry: new RegistryStore(app.getPath("userData")),
    publishEvent: domainEvents.publish,
  });
  const preloadPath = join(import.meta.dirname, "../preload/index.cjs");
  const developmentGitExecutable = process.env.AUTHOR_COPILOT_GIT_EXECUTABLE;
  const gitRuntime = resolveGitRuntime({
    arch: process.arch,
    isPackaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
    ...(developmentGitExecutable === undefined
      ? {}
      : { developmentOverride: developmentGitExecutable }),
  });
  const gitService = new GitService({
    gitExecutable: gitRuntime.executable,
    hooksDirectory: join(app.getPath("userData"), "git-hooks-disabled"),
    resolveProjectRoot: (projectId) => projectService.getProjectRoot(projectId),
    runtimeEnvironment: gitRuntime.environment,
  });

  denyAllPermissions(session.defaultSession);
  if (!target.isDevelopment) {
    installProductionCsp(session.defaultSession);
  }
  registerIpcHandlers(target.url, {
    projectService,
    gitService,
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
    getTabManager: () => tabManager,
  });

  const windowOptions = { target, preloadPath, projectService };
  await createMainWindow(windowOptions);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow(windowOptions);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  quitRequested = true;
});
