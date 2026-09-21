import { EventEmitter } from "node:events";

import type { BrowserWindow, Rectangle, WebContentsView } from "electron";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("electron", () => ({
  dialog: { showMessageBox: vi.fn() },
  WebContentsView: class {},
}));

import { TabManager } from "../src/main/tabs/index.js";

const projectId = "10000000-0000-4000-8000-000000000001";
type ConfirmDiscard = (
  kind: "tab" | "session" | "window",
  dirtyCount: number,
  locale: "en-US" | "zh-CN",
) => Promise<boolean>;

class FakeWebContents extends EventEmitter {
  readonly id: number;
  readonly sent: { channel: string; payload: unknown }[] = [];
  closed = false;
  focused = false;

  constructor(id: number) {
    super();
    this.id = id;
  }

  setWindowOpenHandler(): void {}
  loadURL(): Promise<void> {
    return Promise.resolve();
  }
  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload });
  }
  close(): void {
    this.closed = true;
  }
  isDestroyed(): boolean {
    return this.closed;
  }
  focus(): void {
    this.focused = true;
  }
}

class FakeView {
  readonly webContents: FakeWebContents;
  bounds: Rectangle | undefined;
  visible = false;

  constructor(id: number) {
    this.webContents = new FakeWebContents(id);
  }

  setBackgroundColor(): void {}
  setBounds(bounds: Rectangle): void {
    this.bounds = bounds;
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
  }
}

class FakeWindow extends EventEmitter {
  readonly webContents = new FakeWebContents(1);
  readonly children: FakeView[] = [];
  readonly contentView = {
    addChildView: (view: WebContentsView): void => {
      const fake = view as unknown as FakeView;
      const index = this.children.indexOf(fake);
      if (index >= 0) this.children.splice(index, 1);
      this.children.push(fake);
    },
    removeChildView: (view: WebContentsView): void => {
      const index = this.children.indexOf(view as unknown as FakeView);
      if (index >= 0) this.children.splice(index, 1);
    },
  };
  size: [number, number] = [1180, 760];
  closed = false;

  getContentSize(): [number, number] {
    return this.size;
  }
  isDestroyed(): boolean {
    return this.closed;
  }
  close(): void {
    this.closed = true;
  }
}

describe("TabManager", () => {
  let window: FakeWindow;
  let views: FakeView[];
  let nextId: number;
  let confirmDiscard: Mock<ConfirmDiscard>;

  beforeEach(() => {
    window = new FakeWindow();
    views = [];
    nextId = 10;
    confirmDiscard = vi.fn<ConfirmDiscard>(async () => true);
  });

  function createManager(): TabManager {
    return new TabManager({
      window: window as unknown as BrowserWindow,
      rendererUrl: "file:///app/index.html",
      webPreferences: {},
      resolveProject: async (id) =>
        id === projectId
          ? {
              projectId,
              title: "Test project",
              template: "novel",
              rootDisplayName: "Test project",
            }
          : undefined,
      createView: () => {
        const view = new FakeView(nextId++);
        views.push(view);
        return view as unknown as WebContentsView;
      },
      confirmDiscard,
    });
  }

  it("creates one center view and deduplicates project views", async () => {
    const manager = createManager();
    await Promise.all([manager.startSession(1), manager.startSession(1)]);
    expect(manager.getState(1)).toMatchObject({
      activeTabId: "writer-center",
      tabs: [{ id: "writer-center", kind: "center" }],
    });

    const centerSender = views[0]?.webContents.id;
    expect(centerSender).toBeDefined();
    await manager.openProject(centerSender ?? 0, projectId);
    await manager.activate(1, "writer-center");
    await manager.openProject(centerSender ?? 0, projectId);

    expect(views).toHaveLength(2);
    expect(manager.getState(1).tabs.map(({ id }) => id)).toEqual([
      "writer-center",
      projectId,
    ]);
    expect(views[0]?.visible).toBe(false);
    expect(views[1]?.visible).toBe(true);
  });

  it("tracks dirty state and confirms before destroying a project view", async () => {
    const manager = createManager();
    await manager.startSession(1);
    await manager.openProject(views[0]?.webContents.id ?? 0, projectId);
    manager.reportDirty(views[1]?.webContents.id ?? 0, true);
    confirmDiscard.mockResolvedValueOnce(false);

    await expect(manager.close(1, projectId)).resolves.toEqual({
      status: "cancelled",
    });
    expect(views[1]?.webContents.closed).toBe(false);

    await expect(manager.close(1, projectId)).resolves.toEqual({
      status: "completed",
    });
    expect(views[1]?.webContents.closed).toBe(true);
    expect(manager.getState(1).activeTabId).toBe("writer-center");
  });

  it("resizes every child view below the native tab strip", async () => {
    const manager = createManager();
    await manager.startSession(1);
    await manager.openProject(views[0]?.webContents.id ?? 0, projectId);
    window.size = [900, 640];
    window.emit("resize");

    expect(views.map(({ bounds }) => bounds)).toEqual([
      { x: 0, y: 42, width: 900, height: 598 },
      { x: 0, y: 42, width: 900, height: 598 },
    ]);
    manager.dispose();
    expect(views.every(({ webContents }) => webContents.closed)).toBe(true);
  });

  it("recreates a failed view when its tab is selected again", async () => {
    const manager = createManager();
    await manager.startSession(1);
    views[0]?.webContents.emit("render-process-gone");
    expect(manager.getState(1).tabs[0]?.failed).toBe(true);

    await manager.activate(1, "writer-center");
    expect(views).toHaveLength(2);
    expect(views[0]?.webContents.closed).toBe(true);
    expect(manager.getState(1).tabs[0]?.failed).toBe(false);
  });

  it("guards the main window when a project has unsaved changes", async () => {
    const manager = createManager();
    await manager.startSession(1);
    await manager.openProject(views[0]?.webContents.id ?? 0, projectId);
    manager.reportDirty(views[1]?.webContents.id ?? 0, true);
    confirmDiscard.mockResolvedValueOnce(false);
    const cancelledEvent = { preventDefault: vi.fn() };

    window.emit("close", cancelledEvent);
    await Promise.resolve();
    await Promise.resolve();
    expect(cancelledEvent.preventDefault).toHaveBeenCalledOnce();
    expect(window.closed).toBe(false);

    const confirmedEvent = { preventDefault: vi.fn() };
    window.emit("close", confirmedEvent);
    await Promise.resolve();
    await Promise.resolve();
    expect(window.closed).toBe(true);
    expect(views.every(({ webContents }) => webContents.closed)).toBe(true);
  });

  it("enforces renderer roles for tab operations", async () => {
    const manager = createManager();
    await manager.startSession(1);
    expect(() => manager.openProject(1, projectId)).toThrow(
      "Tab operation is not allowed",
    );
    expect(() => manager.reportDirty(1, true)).toThrow(
      "Tab operation is not allowed",
    );
  });
});
