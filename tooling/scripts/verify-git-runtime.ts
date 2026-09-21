import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadManifest,
  selectTarget,
  verifyRuntime,
} from "./git-runtime-lib.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function parseArguments(argv: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    argv.map((argument) => {
      const match = /^--([a-z-]+)=(.+)$/u.exec(argument);
      if (match?.[1] === undefined || match[2] === undefined) {
        throw new Error(`Unsupported argument: ${argument}`);
      }
      return [match[1], match[2]];
    }),
  );
}

function run(
  executable: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolveRun(stdout);
      else reject(new Error(`Git failed (${String(code)}): ${stderr.trim()}`));
    });
  });
}

async function qualifyRuntime(
  runtimeRoot: string,
  target: {
    readonly executable: string;
    readonly execPath: string;
    readonly templateDir: string;
    readonly caBundlePath: string;
    readonly version: string;
  },
): Promise<void> {
  const executable = join(runtimeRoot, target.executable);
  const environment = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_EXEC_PATH: join(runtimeRoot, target.execPath),
    GIT_SSL_CAINFO: join(runtimeRoot, target.caBundlePath),
    GIT_TEMPLATE_DIR: join(runtimeRoot, target.templateDir),
    GIT_TERMINAL_PROMPT: "0",
  };
  const root = await mkdtemp(join(tmpdir(), "author-copilot-runtime-"));
  try {
    const version = await run(executable, ["--version"], root, environment);
    if (
      !version.includes(target.version.split(".windows")[0] ?? target.version)
    ) {
      throw new Error(`Unexpected bundled Git version: ${version.trim()}`);
    }
    await run(executable, ["init", "--initial-branch=main"], root, environment);
    await writeFile(join(root, "第一章 with spaces.md"), "初稿\n", "utf8");
    await run(executable, ["add", "--all", "--", "."], root, environment);
    await run(
      executable,
      [
        "-c",
        "user.name=Author Copilot",
        "-c",
        "user.email=author-copilot@local",
        "commit",
        "--no-verify",
        "-m",
        "runtime qualification",
      ],
      root,
      environment,
    );
    await run(executable, ["switch", "-c", "runtime-check"], root, environment);
    await writeFile(join(root, "第一章 with spaces.md"), "修改\n", "utf8");
    const diff = await run(
      executable,
      ["diff", "--no-ext-diff", "--", "."],
      root,
      environment,
    );
    if (!diff.includes("修改")) throw new Error("Bundled Git diff failed.");
    const log = await run(
      executable,
      ["log", "-1", "--format=%s"],
      root,
      environment,
    );
    if (log.trim() !== "runtime qualification") {
      throw new Error("Bundled Git log failed.");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const platform = args.platform ?? process.platform;
  const arch = args.arch ?? process.arch;
  const manifest = await loadManifest(
    resolve(
      args.manifest ??
        join(repositoryRoot, "tooling", "git-runtime-manifest.json"),
    ),
  );
  const runtimeRoot = resolve(
    args.runtime ?? join(repositoryRoot, "apps", "desktop", "resources", "git"),
  );
  const { key, target } = selectTarget(manifest, platform, arch);
  await verifyRuntime(runtimeRoot, manifest, key, target);
  if (platform === process.platform && arch === process.arch) {
    await qualifyRuntime(runtimeRoot, target);
    process.stdout.write(`Qualified Git runtime ${key} ${target.version}.\n`);
  } else {
    process.stdout.write(
      `Verified Git runtime structure for ${key}; execution requires a matching host.\n`,
    );
  }
}

await main();
