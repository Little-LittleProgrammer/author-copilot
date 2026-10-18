import { describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ save: vi.fn(), owner: { id: 1 } }));
vi.mock("electron", () => ({
  BrowserWindow: { getFocusedWindow: () => native.owner },
  dialog: { showSaveDialog: native.save },
}));
import { createProjectDirectoryPicker } from "../src/main/project-dialogs.js";

describe("native export destination", () => {
  it("uses a format-specific save dialog with overwrite confirmation and cancellation", async () => {
    native.save
      .mockResolvedValueOnce({
        canceled: false,
        filePath: "/delivery/book.docx",
      })
      .mockResolvedValueOnce({ canceled: true });
    const picker = createProjectDirectoryPicker();
    const options = {
      fileName: "book.docx",
      format: "docx",
      locale: "zh-CN",
    } as const;
    expect(await picker.chooseExportDestination(options)).toBe(
      "/delivery/book.docx",
    );
    expect(native.save).toHaveBeenCalledWith(
      native.owner,
      expect.objectContaining({
        title: "导出作品",
        filters: [{ name: "Word", extensions: ["docx"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      }),
    );
    expect(await picker.chooseExportDestination(options)).toBeUndefined();
  });
});
