import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const rules = [
  {
    directory: "apps/desktop/src/renderer",
    forbidden:
      /(?:from\s+|import\s*\()["'](?:electron|node:|fs(?:\/|["'])|path(?:\/|["'])|child_process(?:\/|["']))/,
    reason: "Renderer code cannot import Electron or Node.js capabilities",
  },
  {
    directory: "packages/contracts/src",
    forbidden: /(?:from\s+|import\s*\()["'](?:@nestjs\/|electron|node:)/,
    reason: "Shared contracts must remain runtime-neutral",
  },
  {
    directory: "packages/project-schema/src",
    forbidden: /(?:from\s+|import\s*\()["'](?:@nestjs\/|electron|node:)/,
    reason: "Project schema must remain runtime-neutral",
  },
  {
    directory: "apps/desktop/src/preload",
    forbidden: /exposeInMainWorld\([^)]*(?:ipcRenderer|require|process)/s,
    reason: "Preload cannot expose raw Electron or Node.js primitives",
  },
];

async function sourceFiles(directory) {
  const absoluteDirectory = path.join(repositoryRoot, directory);
  const entries = await readdir(absoluteDirectory, {
    withFileTypes: true,
  }).catch((error) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(relativePath)));
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.push(relativePath);
    }
  }
  return files;
}

const violations = [];
for (const rule of rules) {
  for (const file of await sourceFiles(rule.directory)) {
    const contents = await readFile(path.join(repositoryRoot, file), "utf8");
    if (rule.forbidden.test(contents)) {
      violations.push(`${file}: ${rule.reason}`);
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Workspace boundary checks passed.");
}
