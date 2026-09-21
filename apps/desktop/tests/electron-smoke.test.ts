import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

const exec = promisify(execFile);

it.skipIf(process.platform === "win32")(
  "rejects a ready executable that exits unsuccessfully",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "author-smoke-exit-"));
    try {
      const executable = join(root, "fake-electron");
      const runner = resolve(
        import.meta.dirname,
        "../scripts/electron-smoke.ts",
      );
      await writeFile(
        executable,
        '#!/bin/sh\nprintf "AUTHOR_COPILOT_ELECTRON_SMOKE_READY\\n"\nexit 42\n',
        { mode: 0o700 },
      );
      await expect(
        exec(process.execPath, [runner, "--executable", executable]),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("code=42"),
      });
      await writeFile(
        executable,
        '#!/bin/sh\nprintf "AUTHOR_COPILOT_ELECTRON_SMOKE_READY\\n"\nexit 0\n',
      );
      await expect(
        exec(process.execPath, [runner, "--executable", executable]),
      ).resolves.toMatchObject({
        stdout: expect.stringContaining("AUTHOR_COPILOT_ELECTRON_SMOKE_READY"),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
