import type { ProviderService } from "./ai/provider-service.js";
import { registerAiSettingsHandlers } from "./ipc/ai-settings-handlers.js";
import type { AgentTaskService } from "./ai/agent/task-service.js";
import { registerAgentIpcHandlers } from "./ipc/agent-handlers.js";
import {
  IPC_INVOKE_CHANNELS,
  RuntimeInfoRequestSchema,
  RuntimeInfoSchema,
} from "@author-copilot/contracts";
import { app, ipcMain, type IpcMainInvokeEvent } from "electron";

import type { SecureCredentialStore } from "./credentials/index.js";
import type { AiOrchestrator } from "./ai/index.js";
import type { AiPatchApplicationService } from "./ai/index.js";
import { assertTrustedIpcRequest } from "./ipc-policy.js";
import { registerAiCredentialIpcHandlers } from "./ipc/ai-credential-handlers.js";
import { registerAiChatIpcHandlers } from "./ipc/ai-chat-handlers.js";
import { registerAiProposalIpcHandlers } from "./ipc/ai-proposal-handlers.js";
import { registerProjectIpcHandlers } from "./ipc/project-handlers.js";
import { registerKnowledgeIpcHandlers } from "./ipc/knowledge-handlers.js";
import { registerTabIpcHandlers } from "./ipc/tab-handlers.js";
import { registerTaskRecoveryIpcHandlers } from "./ipc/task-recovery-handlers.js";
import { registerVersionIpcHandlers } from "./ipc/version-handlers.js";
import type { ProjectDirectoryPicker } from "./project-dialogs.js";
import type { ProjectService } from "./project/index.js";
import type { GitService, TaskSnapshotService } from "./git/index.js";
import type { KnowledgeService } from "./knowledge/index.js";
import type { TabManager } from "./tabs/index.js";

import { registerWritingStatisticsHandlers } from "./ipc/writing-statistics-handlers.js";
import type { WritingStatisticsService } from "./writing-statistics/writing-statistics-service.js";

export interface IpcHandlerOptions {
  readonly writingStatisticsService: WritingStatisticsService;
  readonly providerService: ProviderService;
  readonly agentService: AgentTaskService;
  readonly aiOrchestrator: AiOrchestrator;
  readonly patchApplication: AiPatchApplicationService;
  readonly credentialStore: SecureCredentialStore;
  readonly projectService: ProjectService;
  readonly gitService: GitService;
  readonly taskSnapshotService: TaskSnapshotService;
  readonly knowledgeService: KnowledgeService;
  readonly directoryPicker: ProjectDirectoryPicker;
  readonly onRuntimeInfo?: () => void;
  readonly getTabManager: () => TabManager | undefined;
}

export function registerIpcHandlers(
  trustedRendererUrl: string,
  options: IpcHandlerOptions,
): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.runtimeGetInfo,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const senderFrame = event.senderFrame;
      assertTrustedIpcRequest({
        channel: IPC_INVOKE_CHANNELS.runtimeGetInfo,
        senderFrameUrl: senderFrame?.url ?? "",
        mainFrameUrl: event.sender.mainFrame.url,
        trustedRendererUrl,
        isMainFrame:
          senderFrame !== null && senderFrame === event.sender.mainFrame,
        args,
      });

      RuntimeInfoRequestSchema.parse({});

      const runtimeInfo = RuntimeInfoSchema.parse({
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        packaged: app.isPackaged,
      });
      options.onRuntimeInfo?.();
      return runtimeInfo;
    },
  );

  registerWritingStatisticsHandlers({
    trustedRendererUrl,
    service: options.writingStatisticsService,
    getTabManager: options.getTabManager,
  });
  registerAiSettingsHandlers(options.providerService, trustedRendererUrl);
  registerAiCredentialIpcHandlers({
    trustedRendererUrl,
    credentialStore: options.credentialStore,
  });
  registerAgentIpcHandlers({
    trustedRendererUrl,
    service: options.agentService,
  });
  registerAiChatIpcHandlers({
    trustedRendererUrl,
    orchestrator: options.aiOrchestrator,
  });
  registerAiProposalIpcHandlers({
    trustedRendererUrl,
    patchApplication: options.patchApplication,
  });
  registerProjectIpcHandlers({
    trustedRendererUrl,
    projectService: options.projectService,
    directoryPicker: options.directoryPicker,
    onProjectChanged: (project) =>
      options.getTabManager()?.projectChanged(project),
  });
  registerKnowledgeIpcHandlers({
    trustedRendererUrl,
    knowledgeService: options.knowledgeService,
  });
  registerVersionIpcHandlers({
    trustedRendererUrl,
    gitService: options.gitService,
  });
  registerTaskRecoveryIpcHandlers({
    trustedRendererUrl,
    taskSnapshotService: options.taskSnapshotService,
    agentService: options.agentService,
  });
  registerTabIpcHandlers({
    trustedRendererUrl,
    getTabManager: options.getTabManager,
  });
}
