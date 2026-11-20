import { readFile } from "node:fs/promises";
import { setWorkspaceTransition } from "./ipc-policy.js";
import { WorkspaceService } from "./workspace/workspace-service.js";
import { NativeToolPolicy } from "./ai/agent/native-tool-policy.js";
import { GlobalAssistantService } from "./ai/global-assistant-service.js";
import { ConversationStore } from "./ai/conversation-store.js";
import { ApiBaseUrlSchema } from "@author-copilot/contracts";
import { ProviderService } from "./ai/provider-service.js";
import { PlatformClient } from "./platform/platform-client.js";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  AgentCapabilityService,
  AgentTaskStartService,
  AgentTaskRuntimeService,
  AgentTaskService,
} from "./ai/agent/index.js";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow, session } from "electron";
import type { ProjectSummary } from "@author-copilot/contracts";

import {
  AiContextAssembler,
  AiOrchestrator,
  AiPatchApplicationService,
  AiPatchValidator,
  AnthropicClaudeTransport,
} from "./ai/index.js";

import {
  electronCredentialEncryption,
  SecureCredentialStore,
} from "./credentials/index.js";
import { createEphemeralE2eCredentialEncryption } from "./credentials/e2e-credential-encryption.js";
import { DesktopDomainEvents } from "./domain-events.js";
import {
  GitService,
  ProjectOperationQueue,
  TaskSnapshotService,
} from "./git/index.js";
import { resolveGitRuntime } from "./git-runtime.js";
import { registerIpcHandlers } from "./ipc.js";
import { WritingStatisticsService } from "./writing-statistics/writing-statistics-service.js";
import { CreativeNoteGenerationService } from "./ai/creative-note-generation-service.js";
import { CreativeNotesService } from "./creative-notes/creative-notes-service.js";

import { KnowledgeService } from "./knowledge/index.js";
import {
  createFixedProjectDirectoryPicker,
  createProjectDirectoryPicker,
} from "./project-dialogs.js";
import {
  ProjectBackupBlockedError,
  ProjectService,
  RegistryStore,
} from "./project/index.js";
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

let writingStatisticsService: WritingStatisticsService | undefined;
let creativeNoteGenerationService: CreativeNoteGenerationService | undefined;
let globalAssistantService: GlobalAssistantService | undefined;
let creativeNotesService: CreativeNotesService | undefined;
let mainWindow: BrowserWindow | undefined;
let writingStateService: ProjectService | undefined;
let conversationService: ConversationStore | undefined;
let tabManager: TabManager | undefined;
let quitRequested = false;
let agentService: AgentTaskService | undefined;
let agentShutdownComplete = false;
let agentShutdownPending = false;
let aiOrchestrator: AiOrchestrator | undefined;
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
  readonly beforeEndSession: () => Promise<void>;
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
    rootDisplayName: project.metadata.title,
  };
}

async function createMainWindow(options: MainWindowOptions): Promise<void> {
  mainWindow = new BrowserWindow(createWindowOptions(options.preloadPath));

  lockDownWindow(mainWindow);
  tabManager = new TabManager({
    beforeEndSession: options.beforeEndSession,
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
  const workspace = new WorkspaceService(app.getPath("userData"));
  await workspace.initialize();
  writingStatisticsService = new WritingStatisticsService(() =>
    workspace.runtime("writing-statistics"),
  );
  creativeNotesService = new CreativeNotesService(
    (projectId) => projectService.getProjectRoot(projectId),
    (projectId) => agentService?.assertIdle(projectId),
  );
  const domainEvents = new DesktopDomainEvents();
  const gitOperationQueue = new ProjectOperationQueue();
  const projectService: ProjectService = new ProjectService({
    registry: new RegistryStore(() => workspace.runtime("registry")),
    projectsRoot: () => workspace.projectsRoot,
    initializeProject: (root, title) =>
      workspace.initializeProject(root, title),
    onRegistryChanged: async () =>
      workspace.publishCatalog(await projectService.list()),
    assertCanMutate: (projectId) => agentService?.assertIdle(projectId),
    assertBackupReady: async (projectId) => {
      if (
        await taskSnapshotService.hasRecoverableTaskWhileProjectLocked(
          projectId,
        )
      )
        throw new ProjectBackupBlockedError(
          "请先审阅并保留或恢复 AI 任务，再备份作品 / Review and keep or restore pending AI changes before backing up.",
        );
    },
    publishEvent: domainEvents.publish,
    operationQueue: gitOperationQueue,
  });
  writingStateService = projectService;
  conversationService = new ConversationStore(() =>
    workspace.runtime("conversations"),
  );
  const credentialStore = new SecureCredentialStore({
    filePath: join(
      app.getPath("userData"),
      "credentials",
      "secure-credentials.json",
    ),
    encryption:
      e2eMode && process.env.AUTHOR_COPILOT_E2E_CREDENTIAL_ENCRYPTION === "1"
        ? createEphemeralE2eCredentialEncryption()
        : electronCredentialEncryption,
  });
  const knowledgeService = new KnowledgeService({
    storageRoot: () => workspace.runtime("knowledge-indexes"),
    projectService,
  });
  domainEvents.subscribe(knowledgeService.handleDocumentSaved);
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
  const gitIsolationDirectory = join(
    app.getPath("userData"),
    "git-hooks-disabled",
  );
  const taskSnapshotService = new TaskSnapshotService({
    gitExecutable: gitRuntime.executable,
    isolationDirectory: gitIsolationDirectory,
    get snapshotsRoot() {
      return workspace.runtime("task-snapshots");
    },
    resolveProjectRoot: (projectId) => projectService.getProjectRoot(projectId),
    runtimeEnvironment: gitRuntime.environment,
    operationQueue: gitOperationQueue,
  });
  const gitService = new GitService({
    gitExecutable: gitRuntime.executable,
    hooksDirectory: gitIsolationDirectory,
    resolveProjectRoot: (projectId) => projectService.getProjectRoot(projectId),
    runtimeEnvironment: gitRuntime.environment,
    operationQueue: gitOperationQueue,
    hasRecoverableTask: (projectId) =>
      taskSnapshotService.hasRecoverableTaskWhileProjectLocked(projectId),
  });
  const capabilities = new AgentCapabilityService({});
  const agentRuntime = new AgentTaskRuntimeService({
    capabilityService: capabilities,
    createPolicy: async (input, capability) => {
      if (input.readOnly) await workspace.initialize();
      const skills = await workspace.skills(
        input.readOnly ? undefined : input.projectRoot,
        false,
      );
      return {
        skills: skills.names,
        instructions: (
          await readFile(join(input.projectRoot, "CLAUDE.md"), "utf8")
        ).slice(0, 64_000),
        policy: new NativeToolPolicy({
          capability,
          capabilityService: capabilities,
          projectRoot: input.projectRoot,
          skills: skills.names,
          skillReadRoots: skills.readRoots,
          ...(input.readOnly
            ? { readOnly: true }
            : { snapshots: taskSnapshotService }),
          onFilesChanged: async () => {
            if (!input.readOnly)
              await knowledgeService.invalidateProject(input.projectId);
          },
        }),
      };
    },
    ...(e2eMode && process.env.AUTHOR_COPILOT_E2E_AGENT_BASE_URL !== undefined
      ? {
          createQuery: ({ prompt, options }) =>
            query({
              prompt,
              options: {
                ...options,
                env: {
                  ...options.env,
                  ANTHROPIC_BASE_URL:
                    process.env.AUTHOR_COPILOT_E2E_AGENT_BASE_URL,
                },
              },
            }),
        }
      : {}),
  });
  const platformClient = new PlatformClient(
    process.env.AUTHOR_COPILOT_PLATFORM_URL
      ? ApiBaseUrlSchema.parse(process.env.AUTHOR_COPILOT_PLATFORM_URL)
      : undefined,
    credentialStore,
  );
  await workspace.selectIdentity((await platformClient.user())?.id ?? "local");
  const providerService = new ProviderService(
    join(app.getPath("userData"), "ai-providers.json"),
    credentialStore,
    platformClient,
  );
  agentService = new AgentTaskService({
    ...(e2eMode && process.env.AUTHOR_COPILOT_E2E_AGENT_BASE_URL
      ? {}
      : { providers: providerService }),
    capabilities,
    runtime: agentRuntime,
    startService: new AgentTaskStartService({
      initializeRepository: (projectId) =>
        gitService.initializeRepository(projectId),
      capabilityService: capabilities,
      projectService,
      taskSnapshotService,
    }),
    snapshots: taskSnapshotService,
    projects: projectService,
    credentials: credentialStore,
    getConfigDirectory: async (projectId) => {
      await workspace.initialize();
      const root = await projectService.getProjectRoot(projectId);
      await workspace.initializeProject(root, "Writing workspace");
      await workspace.skills(root);
      return workspace.runtimeConfigDirectory;
    },
    onFilesChanged: async (projectId) => {
      await knowledgeService.invalidateProject(projectId);
    },
  });
  const patchApplication = new AiPatchApplicationService({
    projectService,
    gitService,
  });
  aiOrchestrator = new AiOrchestrator({
    ...(e2eMode && process.env.AUTHOR_COPILOT_E2E_ANTHROPIC_BASE_URL
      ? {}
      : { providers: providerService }),
    contextAssembler: new AiContextAssembler({
      projectService,
      knowledgeService,
    }),
    credentialStore,
    patchValidator: new AiPatchValidator({ projectService }),
    patchApplication,
    transport: new AnthropicClaudeTransport({
      ...(e2eMode &&
      process.env.AUTHOR_COPILOT_E2E_ANTHROPIC_BASE_URL !== undefined
        ? { baseURL: process.env.AUTHOR_COPILOT_E2E_ANTHROPIC_BASE_URL }
        : {}),
    }),
  });

  creativeNoteGenerationService = new CreativeNoteGenerationService({
    notes: creativeNotesService,
    projects: projectService,
    credentials: credentialStore,
    ...(e2eMode && process.env.AUTHOR_COPILOT_E2E_ANTHROPIC_BASE_URL
      ? {}
      : { providers: providerService }),
    transport: new AnthropicClaudeTransport({
      ...(e2eMode && process.env.AUTHOR_COPILOT_E2E_ANTHROPIC_BASE_URL
        ? { baseURL: process.env.AUTHOR_COPILOT_E2E_ANTHROPIC_BASE_URL }
        : {}),
    }),
  });
  denyAllPermissions(session.defaultSession);
  if (!target.isDevelopment) {
    installProductionCsp(session.defaultSession);
  }
  const globalAssistant = new GlobalAssistantService({
    workspace,
    projects: projectService,
    providers: providerService,
    runtime: agentRuntime,
    capabilities,
  });
  globalAssistantService = globalAssistant;
  const settleWorkspace = async () => {
    await agentService?.cancelAll();
    await globalAssistant.cancelAll();
    await aiOrchestrator?.cancelAndDrain();
    await creativeNoteGenerationService?.cancelAndDrain();
    await knowledgeService.cancelAndDrain();
    await writingStatisticsService?.drain();
    await creativeNotesService?.drain();
    await projectService.drain();
    await conversationService?.drain();
    await gitOperationQueue.drain();
  };
  registerIpcHandlers(target.url, {
    globalAssistant,
    getWorkspaceId: () => workspace.accountId,
    beforeIdentityChange: async () => {
      await tabManager?.closeProjectsForIdentityChange();
      await settleWorkspace();
    },
    afterIdentityChange: async () => {
      try {
        await workspace.selectIdentity(
          (await platformClient.user())?.id ?? "local",
        );
      } catch (error) {
        await platformClient.logout();
        await workspace.selectIdentity("local");
        throw error;
      } finally {
        setImmediate(() => tabManager?.workspaceChanged());
      }
    },
    creativeNoteGenerationService,
    conversationStore: conversationService,
    writingStatisticsService,
    creativeNotesService,
    providerService,
    agentService,
    aiOrchestrator,
    patchApplication,
    credentialStore,
    projectService,
    gitService,
    taskSnapshotService,
    knowledgeService,
    directoryPicker:
      e2eMode && process.env.AUTHOR_COPILOT_E2E_DIRECTORY !== undefined
        ? createFixedProjectDirectoryPicker({
            ...(process.env.AUTHOR_COPILOT_E2E_EXPORT_DIRECTORY
              ? {
                  exportDirectory:
                    process.env.AUTHOR_COPILOT_E2E_EXPORT_DIRECTORY,
                }
              : {}),
            importSource:
              process.env.AUTHOR_COPILOT_E2E_IMPORT_SOURCE ??
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

  const windowOptions = {
    target,
    preloadPath,
    projectService,
    beforeEndSession: async () => {
      setWorkspaceTransition(true);
      try {
        await settleWorkspace();
        if (
          platformClient.baseURL &&
          (await credentialStore.getApiKeyStatus("platform-refresh")).configured
        )
          await platformClient.logout();
        await workspace.selectIdentity("local");
      } finally {
        setWorkspaceTransition(false);
      }
    },
  };
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

app.on("will-quit", (event) => {
  if (agentService !== undefined && !agentShutdownComplete) {
    event.preventDefault();
    if (!agentShutdownPending) {
      agentShutdownPending = true;
      void Promise.all([
        agentService.shutdown(),
        globalAssistantService?.cancelAll(),
        writingStatisticsService?.drain(),
        creativeNotesService?.drain(),
        writingStateService?.drain(),
        conversationService?.drain(),
      ]).finally(() => {
        agentShutdownComplete = true;
        setImmediate(() => app.quit());
      });
    }
  }
});

app.on("before-quit", () => {
  quitRequested = true;
  aiOrchestrator?.cancelAll("shutdown");
  creativeNoteGenerationService?.cancelAll();
});
