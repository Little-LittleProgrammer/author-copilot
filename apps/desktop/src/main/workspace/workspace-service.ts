import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { copyDirectoryWithoutSymlinks } from "../project/copy-project.js";
import { atomicWriteFile } from "../project/file-utils.js";

export type StorageRoot = string | (() => string);
export function storageRoot(root: StorageRoot): string {
  return typeof root === "function" ? root() : root;
}

const IdentitySchema = z.union([z.literal("local"), z.uuid()]);
const sharedSkills = {
  "writing-techniques":
    "Use writing techniques for pacing, voice, dialogue and revision. Read the work's CLAUDE.md and relevant assets first. Preserve the author's voice; distinguish suggestions from established facts. Cite manuscript paths and request review of changes.",
  "read-outline":
    "Find and read the work's 创作资产/资料.md and other outline files. Match kind=outline metadata to the author's question. Read relevant manuscript sources, preserve source qualifiers, and identify missing or stale information. Never invent an existing outline.",
};
const globalSkills = {
  "locate-work":
    "Read projects.json to locate works by title and projectId. Then use Read, Glob and Grep inside the selected projects/<projectId> folder. Cite work title, projectId and relative source path. Never confuse identically named works.",
  "compare-works":
    "Locate the requested works in projects.json, read the relevant manuscripts and creative assets, and compare their plots, characters or themes. Label every source by work and path. Treat each work's canon separately. This workspace is read-only; propose changes for the corresponding work assistant.",
};

async function writeDefault(path: string, content: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1)
      throw new Error("Workspace files cannot be redirected.");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    await atomicWriteFile(path, content, 0o600);
  }
}

async function safeDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if ((await lstat(path)).isSymbolicLink() || (await realpath(path)) !== path)
    throw new Error("Workspace directories cannot be redirected.");
}

export class WorkspaceService {
  private identity = "local";
  private canonicalUserData: string | undefined;
  constructor(readonly userData: string) {}
  get accountId(): string {
    return this.identity;
  }
  get accountRoot(): string {
    return join(
      this.canonicalUserData ?? this.userData,
      "accounts",
      this.identity,
    );
  }
  get root(): string {
    return join(this.accountRoot, "workspace");
  }
  get projectsRoot(): string {
    return join(this.root, "projects");
  }
  get configDirectory(): string {
    return join(this.root, ".claude");
  }
  get runtimeConfigDirectory(): string {
    return this.runtime("claude");
  }
  runtime(name: string): string {
    return join(this.accountRoot, "runtime", name);
  }

  async selectIdentity(identity: string): Promise<void> {
    const parsed = IdentitySchema.parse(identity);
    const previous = this.identity;
    this.identity = parsed;
    try {
      await this.initialize();
      await atomicWriteFile(
        join(this.canonicalUserData ?? this.userData, "current-workspace.json"),
        JSON.stringify({ accountId: parsed }),
        0o600,
      );
    } catch (error) {
      this.identity = previous;
      throw error;
    }
  }

  async initialize(): Promise<void> {
    await mkdir(this.userData, { recursive: true, mode: 0o700 });
    this.canonicalUserData = await realpath(this.userData);
    await safeDirectory(join(this.canonicalUserData, "accounts"));
    await safeDirectory(this.accountRoot);
    await safeDirectory(this.root);
    await safeDirectory(this.projectsRoot);
    await safeDirectory(join(this.accountRoot, "runtime"));
    await safeDirectory(this.runtimeConfigDirectory);
    await this.initializeClaude(this.root);
    await writeDefault(
      join(this.root, "CLAUDE.md"),
      "# Account writing workspace\n\nUse locate-work and compare-works for questions about works. projects.json lists this account's works. This assistant is read-only. Cite the work and source path. Never mix different works' facts.\n",
    );
    for (const [name, description] of Object.entries(sharedSkills))
      await this.seedSkill(this.root, name, description, "both");
    for (const [name, description] of Object.entries(globalSkills))
      await this.seedSkill(this.root, name, description, "global");
  }

  private async initializeClaude(root: string): Promise<void> {
    await safeDirectory(join(root, ".claude"));
    await safeDirectory(join(root, ".claude", "skills"));
    await safeDirectory(join(root, ".claude", "hooks"));
    // Security callbacks are registered by Main, never loaded from executable
    // project configuration. Native settings remain useful for tool defaults.
    await atomicWriteFile(
      join(root, ".claude", "settings.json"),
      JSON.stringify(
        {
          claudeMdExcludes: ["**"],
          permissions: {
            deny: [
              "Bash",
              "PowerShell",
              "Agent",
              "Task",
              "NotebookEdit",
              "WebFetch",
              "WebSearch",
            ],
            additionalDirectories: [],
            blockReadsOutsideWorkingDirectories: true,
            blockWritesOutsideWorkingDirectories: true,
          },
          enableAllProjectMcpServers: false,
        },
        null,
        2,
      ) + "\n",
      0o600,
    );
    await writeDefault(
      join(root, ".claude", "hooks", "README.md"),
      "# Workspace policy hooks\n\nThe application registers native PreToolUse and PostToolUse callbacks in the main process. They enforce workspace paths and record native mutations before execution. Executable hooks from imported settings or Skill frontmatter are not loaded.\n",
    );
    await rm(join(root, ".claude", "settings.local.json"), { force: true });
    await rm(join(root, ".mcp.json"), { force: true });
    for (const name of ["rules", "agents", "commands", "plugins"])
      await rm(join(root, ".claude", name), { recursive: true, force: true });
  }

  async initializeProject(root: string, title: string): Promise<void> {
    await this.initializeClaude(root);
    await mkdir(join(root, "创作资产"), { recursive: true, mode: 0o700 });
    await writeDefault(
      join(root, "CLAUDE.md"),
      `# ${title}\n\nThis directory is one work. Manuscripts are Markdown files organized by volumes/chapters or acts/scenes. Creative assets live in 创作资产/; 资料.md is the canonical note collection. Read relevant assets and source manuscripts before writing. Keep author-confirmed facts and source metadata intact. Use native file tools; all edits are reviewed. Do not access sibling works or change security settings.\n`,
    );
    await this.seedSkill(
      root,
      "continue-story",
      "Read CLAUDE.md, the outline, character notes and the preceding chapter. Continue this work in its established voice. Preserve confirmed facts, mark assumptions, and keep proposed changes within this work for author review.",
      "work",
    );
  }

  private async seedSkill(
    root: string,
    name: string,
    description: string,
    scope: string,
  ): Promise<void> {
    await writeDefault(
      join(root, ".claude", "skills", name, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\nauthor-copilot-scope: ${scope}\n---\n\n${description}\n`,
    );
  }

  async skills(
    projectRoot?: string,
    synchronize = true,
  ): Promise<{ names: string[]; readRoots: string[] }> {
    const skills = new Map<string, string>();
    const scan = async (root: string, isGlobal: boolean) => {
      const directory = join(root, ".claude", "skills");
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const path = join(directory, entry.name);
        const file = join(path, "SKILL.md");
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 256_000)
          throw new Error("Unsafe Skill definition.");
        const content = await readFile(file, "utf8");
        if (
          /^\s*hooks\s*:/mu.test(content) ||
          /^context:\s*fork\s*$/mu.test(content) ||
          /!`/u.test(content)
        )
          throw new Error(
            "Executable Skill hooks and shell substitutions are not enabled.",
          );
        const name = /^name:\s*([a-z0-9-]+)\s*$/mu.exec(content)?.[1];
        if (!name || name !== entry.name)
          throw new Error("Skill names must match their directories.");
        const scope =
          /^author-copilot-scope:\s*(global|work|both)\s*$/mu.exec(
            content,
          )?.[1] ?? (isGlobal ? "both" : "work");
        if (
          (projectRoot && scope === "global") ||
          (!projectRoot && scope === "work")
        )
          continue;
        if ((await realpath(path)) !== path)
          throw new Error("Skill paths cannot be redirected.");
        skills.set(name, path);
      }
    };
    await scan(this.root, true);
    if (projectRoot) {
      if (synchronize) await this.synchronizeSharedSkills(projectRoot, skills);
      skills.clear();
      await scan(projectRoot, false);
    }
    return { names: [...skills.keys()], readRoots: [...skills.values()] };
  }

  private async skillFingerprint(directory: string): Promise<string> {
    const hash = createHash("sha256");
    let bytes = 0;
    const visit = async (path: string, prefix: string) => {
      const info = await lstat(path);
      if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1))
        throw new Error("Skill resources cannot be redirected.");
      if (info.isDirectory()) {
        for (const name of (await readdir(path)).sort())
          await visit(join(path, name), prefix + "/" + name);
      } else if (info.isFile()) {
        bytes += info.size;
        if (bytes > 20 * 1024 * 1024)
          throw new Error("Skill resources exceed the local size limit.");
        hash
          .update(prefix)
          .update("\0")
          .update(await readFile(path));
      } else
        throw new Error("Only ordinary Skill resource files are supported.");
    };
    await visit(directory, "");
    return hash.digest("hex");
  }

  private async synchronizeSharedSkills(
    projectRoot: string,
    shared: ReadonlyMap<string, string>,
  ): Promise<void> {
    const schema = z.record(
      z.string().regex(/^[a-z0-9-]+$/u),
      z.string().regex(/^[a-f0-9]{64}$/u),
    );
    const file = this.runtime(
      "skill-projections/" +
        createHash("sha256").update(projectRoot).digest("hex") +
        ".json",
    );
    let previous: Record<string, string> = {};
    try {
      previous = schema.parse(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    const next: Record<string, string> = {};
    const directory = join(projectRoot, ".claude", "skills");
    for (const name of new Set([...Object.keys(previous), ...shared.keys()])) {
      const destination = join(directory, name);
      let existing: string | undefined;
      try {
        existing = await this.skillFingerprint(destination);
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
      // A locally edited projection becomes a book-specific override.
      if (existing && existing !== previous[name]) continue;
      const source = shared.get(name);
      if (!source) {
        if (existing) await rm(destination, { recursive: true, force: true });
        continue;
      }
      const fingerprint = await this.skillFingerprint(source);
      next[name] = fingerprint;
      if (existing === fingerprint) continue;
      const staging = join(projectRoot, ".claude", ".skill-" + randomUUID());
      try {
        await copyDirectoryWithoutSymlinks(source, staging);
        if ((await this.skillFingerprint(staging)) !== fingerprint)
          throw new Error("The shared Skill changed during loading.");
        if (existing) await rm(destination, { recursive: true });
        await rename(staging, destination);
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    }
    if (JSON.stringify(previous) !== JSON.stringify(next))
      await atomicWriteFile(file, JSON.stringify(next), 0o600);
  }

  async publishCatalog(
    projects: readonly {
      projectId: string;
      metadata: { title: string; template: string };
    }[],
  ): Promise<void> {
    await atomicWriteFile(
      join(this.root, "projects.json"),
      JSON.stringify(
        projects.map(({ projectId, metadata }) => ({
          projectId,
          title: metadata.title,
          template: metadata.template,
          path: `projects/${projectId}`,
        })),
        null,
        2,
      ) + "\n",
      0o600,
    );
  }

  conversationIdentity(): string {
    const hash = createHash("sha256").update(this.identity).digest("hex");
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  }
}
