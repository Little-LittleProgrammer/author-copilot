import {
  IPC_EVENT_CHANNELS,
  ProjectChangedEventSchema,
  TAB_BAR_HEIGHT,
  TabContextSchema,
  TabStateSchema,
  WRITER_CENTER_TAB_ID,
  type ProjectSummary,
  type TabContext,
  type TabOperationResult,
  type TabState,
} from "@author-copilot/contracts";
import {
  dialog,
  WebContentsView,
  type BrowserWindow,
  type Event,
  type WebPreferences,
} from "electron";

import { lockDownWebContents } from "../security-policy.js";

interface TabEntry {
  context: Exclude<TabContext, { readonly kind: "shell" }>;
  dirty: boolean;
  failed: boolean;
  view: WebContentsView;
}

type TabRole = TabContext["kind"];

export interface TabManagerOptions {
  readonly window: BrowserWindow;
  readonly rendererUrl: string;
  readonly webPreferences: WebPreferences;
  readonly resolveProject: (
    projectId: string,
  ) => Promise<ProjectSummary | undefined>;
  readonly createView?: (webPreferences: WebPreferences) => WebContentsView;
  readonly confirmDiscard?: (
    kind: "tab" | "session" | "window",
    dirtyCount: number,
    locale: "en-US" | "zh-CN",
  ) => Promise<boolean>;
  readonly afterConfirmedWindowClose?: () => void;
  readonly afterCancelledWindowClose?: () => void;
}

export class TabManager {
  private readonly window: BrowserWindow;
  private readonly rendererUrl: string;
  private readonly webPreferences: WebPreferences;
  private readonly resolveProject: TabManagerOptions["resolveProject"];
  private readonly createView: NonNullable<TabManagerOptions["createView"]>;
  private readonly confirmDiscard: NonNullable<
    TabManagerOptions["confirmDiscard"]
  >;
  private readonly afterConfirmedWindowClose:
    TabManagerOptions["afterConfirmedWindowClose"] | undefined;
  private readonly afterCancelledWindowClose:
    TabManagerOptions["afterCancelledWindowClose"] | undefined;
  private readonly entries: TabEntry[] = [];
  private readonly contexts = new Map<number, TabContext>();
  private activeTabId: string | null = null;
  private locale: "en-US" | "zh-CN" = "zh-CN";
  private closing = false;
  private closeConfirmationPending = false;
  private disposed = false;
  private operations: Promise<void> = Promise.resolve();

  constructor(options: TabManagerOptions) {
    this.window = options.window;
    this.rendererUrl = options.rendererUrl;
    this.webPreferences = options.webPreferences;
    this.resolveProject = options.resolveProject;
    this.createView =
      options.createView ??
      ((webPreferences) => new WebContentsView({ webPreferences }));
    this.confirmDiscard =
      options.confirmDiscard ??
      ((kind, dirtyCount, locale) =>
        this.showDiscardConfirmation(kind, dirtyCount, locale));
    this.afterConfirmedWindowClose = options.afterConfirmedWindowClose;
    this.afterCancelledWindowClose = options.afterCancelledWindowClose;

    this.contexts.set(this.window.webContents.id, { kind: "shell" });
    this.window.on("resize", this.layout);
    this.window.on("close", this.handleWindowClose);
  }

  getContext(senderId: number): TabContext {
    const context = this.contexts.get(senderId);
    if (context === undefined) throw new Error("Unknown tab renderer");
    return TabContextSchema.parse(context);
  }

  getState(senderId: number): TabState {
    this.assertRole(senderId, ["shell"]);
    return this.state();
  }

  startSession(senderId: number): Promise<TabState> {
    this.assertRole(senderId, ["shell"]);
    return this.enqueue(async () => {
      const existing = this.findEntry(WRITER_CENTER_TAB_ID);
      if (existing === undefined) {
        const entry = await this.createEntry({
          kind: "center",
          tabId: WRITER_CENTER_TAB_ID,
        });
        this.entries.push(entry);
      }
      await this.activateEntry(WRITER_CENTER_TAB_ID);
      return this.publishState();
    });
  }

  openProject(senderId: number, projectId: string): Promise<TabState> {
    this.assertRole(senderId, ["center"]);
    return this.enqueue(async () => {
      if (this.findEntry(projectId) === undefined) {
        const project = await this.resolveProject(projectId);
        if (project === undefined) throw new Error("Project is not registered");
        const entry = await this.createEntry({
          kind: "project",
          tabId: project.projectId,
          project,
        });
        this.entries.push(entry);
      }
      await this.activateEntry(projectId);
      return this.publishState();
    });
  }

  activate(senderId: number, tabId: string): Promise<TabState> {
    this.assertRole(senderId, ["shell"]);
    return this.enqueue(async () => {
      if (this.findEntry(tabId) === undefined) throw new Error("Tab not found");
      await this.activateEntry(tabId);
      return this.publishState();
    });
  }

  close(senderId: number, tabId: string): Promise<TabOperationResult> {
    this.assertRole(senderId, ["shell"]);
    return this.enqueue(async () => {
      if (tabId === WRITER_CENTER_TAB_ID) return { status: "protected" };
      const entry = this.findEntry(tabId);
      if (entry === undefined) return { status: "not_found" };
      if (entry.dirty && !(await this.confirmDiscard("tab", 1, this.locale))) {
        return { status: "cancelled" };
      }

      const index = this.entries.indexOf(entry);
      this.removeEntry(entry);
      if (this.activeTabId === tabId) {
        const fallback = this.entries[Math.max(0, index - 1)];
        this.activeTabId = null;
        if (fallback !== undefined) {
          await this.activateEntry(fallback.context.tabId);
        }
      }
      this.publishState();
      return { status: "completed" };
    });
  }

  endSession(senderId: number): Promise<TabOperationResult> {
    this.assertRole(senderId, ["shell"]);
    return this.enqueue(async () => {
      const dirtyCount = this.dirtyCount();
      if (
        dirtyCount > 0 &&
        !(await this.confirmDiscard("session", dirtyCount, this.locale))
      ) {
        return { status: "cancelled" };
      }
      this.removeAllEntries();
      this.publishState();
      return { status: "completed" };
    });
  }

  reportDirty(senderId: number, dirty: boolean): TabState {
    this.assertRole(senderId, ["project"]);
    const entry = this.findEntryBySender(senderId);
    if (entry === undefined || entry.context.kind !== "project") {
      throw new Error("Project tab not found");
    }
    entry.dirty = dirty;
    return this.publishState();
  }

  setLocale(senderId: number, locale: "en-US" | "zh-CN"): TabState {
    this.assertRole(senderId, ["shell"]);
    this.locale = locale;
    return this.state();
  }

  requestLogout(senderId: number): TabOperationResult {
    this.assertRole(senderId, ["center"]);
    this.sendToShell(IPC_EVENT_CHANNELS.tabLogoutRequested, {});
    return { status: "completed" };
  }

  projectChanged(project: ProjectSummary): void {
    const event = ProjectChangedEventSchema.parse(project);
    const entry = this.findEntry(project.projectId);
    if (entry?.context.kind === "project") {
      entry.context = {
        kind: "project",
        tabId: project.projectId,
        project,
      };
      this.contexts.set(entry.view.webContents.id, entry.context);
    }
    this.sendToAll(IPC_EVENT_CHANNELS.projectChanged, event);
    this.publishState();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.window.off("resize", this.layout);
    this.window.off("close", this.handleWindowClose);
    this.removeAllEntries();
    this.contexts.clear();
  }

  private readonly layout = (): void => {
    const bounds = this.viewBounds();
    for (const entry of this.entries) entry.view.setBounds(bounds);
  };

  private viewBounds(): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const size = this.window.getContentSize();
    const width = size[0] ?? 0;
    const height = size[1] ?? 0;
    return {
      x: 0,
      y: TAB_BAR_HEIGHT,
      width,
      height: Math.max(0, height - TAB_BAR_HEIGHT),
    };
  }

  private readonly handleWindowClose = (event: Event): void => {
    if (this.closing || this.dirtyCount() === 0) {
      this.closing = true;
      this.removeAllEntries();
      return;
    }
    event.preventDefault();
    if (this.closeConfirmationPending) return;
    this.closeConfirmationPending = true;
    void this.confirmDiscard("window", this.dirtyCount(), this.locale).then(
      (confirmed) => {
        this.closeConfirmationPending = false;
        if (!confirmed || this.window.isDestroyed()) {
          this.afterCancelledWindowClose?.();
          return;
        }
        this.closing = true;
        this.removeAllEntries();
        this.window.close();
        this.afterConfirmedWindowClose?.();
      },
    );
  };

  private async createEntry(
    context: Exclude<TabContext, { readonly kind: "shell" }>,
  ): Promise<TabEntry> {
    const view = this.createView(this.webPreferences);
    const entry: TabEntry = { context, dirty: false, failed: false, view };
    this.contexts.set(view.webContents.id, context);
    lockDownWebContents(view.webContents);
    view.setBackgroundColor("#f4f5f7");
    view.setVisible(false);
    this.window.contentView.addChildView(view);
    view.setBounds(this.viewBounds());
    view.webContents.on("did-fail-load", () => {
      entry.failed = true;
      this.publishState();
    });
    view.webContents.on("render-process-gone", () => {
      entry.failed = true;
      this.publishState();
    });
    try {
      await view.webContents.loadURL(this.rendererUrl);
    } catch {
      entry.failed = true;
    }
    if (this.closing || this.disposed || this.window.isDestroyed()) {
      this.contexts.delete(view.webContents.id);
      if (!this.window.isDestroyed()) {
        this.window.contentView.removeChildView(view);
      }
      if (!view.webContents.isDestroyed()) view.webContents.close();
      throw new Error("Tab manager was disposed while loading a view");
    }
    return entry;
  }

  private async activateEntry(tabId: string): Promise<void> {
    let entry = this.findEntry(tabId);
    if (entry === undefined) return;
    if (entry.failed) {
      entry = await this.replaceEntryView(entry);
    }
    for (const candidate of this.entries) {
      candidate.view.setVisible(candidate === entry);
    }
    this.window.contentView.addChildView(entry.view);
    entry.view.setVisible(true);
    entry.view.webContents.focus();
    this.activeTabId = tabId;
  }

  private async replaceEntryView(entry: TabEntry): Promise<TabEntry> {
    const index = this.entries.indexOf(entry);
    const context = entry.context;
    const dirty = entry.dirty;
    this.destroyView(entry);
    const replacement = await this.createEntry(context);
    replacement.dirty = dirty;
    this.entries[index] = replacement;
    return replacement;
  }

  private removeEntry(entry: TabEntry): void {
    const index = this.entries.indexOf(entry);
    if (index >= 0) this.entries.splice(index, 1);
    this.destroyView(entry);
  }

  private destroyView(entry: TabEntry): void {
    this.contexts.delete(entry.view.webContents.id);
    this.window.contentView.removeChildView(entry.view);
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
  }

  private removeAllEntries(): void {
    for (const entry of [...this.entries]) this.destroyView(entry);
    this.entries.length = 0;
    this.activeTabId = null;
  }

  private findEntry(tabId: string): TabEntry | undefined {
    return this.entries.find((entry) => entry.context.tabId === tabId);
  }

  private findEntryBySender(senderId: number): TabEntry | undefined {
    return this.entries.find((entry) => entry.view.webContents.id === senderId);
  }

  private dirtyCount(): number {
    return this.entries.filter((entry) => entry.dirty).length;
  }

  private state(): TabState {
    return TabStateSchema.parse({
      activeTabId: this.activeTabId,
      tabs: this.entries.map((entry) => ({
        id: entry.context.tabId,
        kind: entry.context.kind,
        title:
          entry.context.kind === "center"
            ? WRITER_CENTER_TAB_ID
            : entry.context.project.title,
        dirty: entry.dirty,
        failed: entry.failed,
      })),
    });
  }

  private publishState(): TabState {
    const state = this.state();
    this.sendToShell(IPC_EVENT_CHANNELS.tabStateChanged, state);
    return state;
  }

  private sendToAll(channel: string, payload: unknown): void {
    this.sendToShell(channel, payload);
    for (const entry of this.entries) {
      if (!entry.view.webContents.isDestroyed()) {
        entry.view.webContents.send(channel, payload);
      }
    }
  }

  private sendToShell(channel: string, payload: unknown): void {
    if (!this.window.webContents.isDestroyed()) {
      this.window.webContents.send(channel, payload);
    }
  }

  private assertRole(senderId: number, allowed: readonly TabRole[]): void {
    const role = this.getContext(senderId).kind;
    if (!allowed.includes(role))
      throw new Error("Tab operation is not allowed");
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation, operation);
    this.operations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async showDiscardConfirmation(
    kind: "tab" | "session" | "window",
    dirtyCount: number,
    locale: "en-US" | "zh-CN",
  ): Promise<boolean> {
    const chinese = locale === "zh-CN";
    const detail = chinese
      ? `有 ${dirtyCount} 个作品包含未保存的修改。继续将放弃这些修改。`
      : `${dirtyCount} work${dirtyCount === 1 ? " has" : "s have"} unsaved changes. Continuing will discard them.`;
    const message = chinese
      ? kind === "tab"
        ? "关闭这个标签页？"
        : kind === "session"
          ? "退出当前账号？"
          : "关闭 Author Copilot？"
      : kind === "tab"
        ? "Close this tab?"
        : kind === "session"
          ? "Sign out?"
          : "Close Author Copilot?";
    const result = await dialog.showMessageBox(this.window, {
      type: "warning",
      message,
      detail,
      buttons: chinese ? ["取消", "放弃修改"] : ["Cancel", "Discard changes"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return result.response === 1;
  }
}
