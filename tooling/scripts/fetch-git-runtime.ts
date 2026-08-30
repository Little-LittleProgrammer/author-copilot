import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { cpus } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import {
  loadManifest,
  runtimeMetadata,
  selectTarget,
  validateArchiveEntries,
  verifyRuntime,
  verifySource,
} from "./git-runtime-lib.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const defaultManifestPath = join(
  repositoryRoot,
  "tooling",
  "git-runtime-manifest.json",
);

function parseArguments(argv: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const argument of argv) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(argument);
    if (match?.[1] === undefined || match[2] === undefined) {
      throw new Error(`Unsupported argument: ${argument}`);
    }
    result[match[1]] = match[2];
  }
  return result;
}

function run(
  executable: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 4 * 1024 * 1024) {
        child.kill("SIGKILL");
      }
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolveRun(stdout);
      else {
        reject(
          new Error(
            `${executable} failed with ${signal ?? `exit code ${String(code)}`}.`,
          ),
        );
      }
    });
  });
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || response.body === null) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}.`);
  }
  const partialPath = `${destination}.partial`;
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(partialPath),
  );
  await rm(destination, { force: true });
  await rename(partialPath, destination);
}

async function cachedSource(
  cacheRoot: string,
  source: {
    readonly fileName: string;
    readonly sha256: string;
    readonly url: string;
  },
): Promise<string> {
  await mkdir(cacheRoot, { recursive: true });
  const path = join(cacheRoot, source.fileName);
  try {
    await verifySource(path, source);
    return path;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      await rm(path, { force: true });
    }
  }
  process.stdout.write(`Downloading ${source.url}\n`);
  await download(source.url, path);
  await verifySource(path, source);
  return path;
}

async function extractArchive(archivePath: string, destination: string) {
  const listing = await run("tar", ["-tf", archivePath]);
  validateArchiveEntries(listing.split(/\r?\n/u).filter(Boolean));
  await run("tar", ["-xf", archivePath, "-C", destination]);
}

const gitMakeOptions = [
  "prefix=/",
  "NO_GETTEXT=YesPlease",
  "NO_TCLTK=YesPlease",
  "NO_PERL=YesPlease",
  "NO_PYTHON=YesPlease",
  "NO_INSTALL_HARDLINKS=YesPlease",
  "APPLE_COMMON_CRYPTO=YesPlease",
  "NO_OPENSSL=YesPlease",
];

async function materializeRequiredFileLinks(
  runtimeRoot: string,
  requiredPaths: readonly {
    readonly path: string;
    readonly type: "file" | "directory";
  }[],
): Promise<void> {
  const canonicalRoot = await realpath(runtimeRoot);
  for (const required of requiredPaths) {
    if (required.type !== "file") continue;
    const requiredPath = join(runtimeRoot, required.path);
    const linkStats = await lstat(requiredPath);
    if (!linkStats.isSymbolicLink()) continue;

    const resolvedPath = await realpath(requiredPath);
    const relativePath = relative(canonicalRoot, resolvedPath);
    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new Error(
        `Required runtime link escapes the runtime root: ${required.path}`,
      );
    }
    const resolvedStats = await stat(resolvedPath);
    if (!resolvedStats.isFile()) {
      throw new Error(
        `Required runtime link does not resolve to a file: ${required.path}`,
      );
    }

    const materializedPath = `${requiredPath}.materialized`;
    await copyFile(resolvedPath, materializedPath);
    await chmod(materializedPath, resolvedStats.mode & 0o7777);
    await unlink(requiredPath);
    await rename(materializedPath, requiredPath);
  }
}

async function buildMacRuntime(
  target: {
    readonly arch: string;
    readonly archive: { readonly sourceRoot?: string };
    readonly caBundle?: {
      readonly fileName: string;
      readonly sha256: string;
      readonly url: string;
    };
    readonly caBundlePath: string;
    readonly deploymentTarget?: string;
    readonly requiredPaths: readonly {
      readonly path: string;
      readonly type: "file" | "directory";
    }[];
  },
  archivePath: string,
  cacheRoot: string,
  workRoot: string,
  runtimeRoot: string,
): Promise<void> {
  if (process.platform !== "darwin" || process.arch !== target.arch) {
    throw new Error(
      `macOS Git must be built on its target architecture (${target.arch}).`,
    );
  }
  if (
    target.archive.sourceRoot === undefined ||
    target.caBundle === undefined ||
    target.deploymentTarget === undefined
  ) {
    throw new Error("The macOS runtime manifest is incomplete.");
  }
  await extractArchive(archivePath, workRoot);
  const sourceRoot = join(workRoot, target.archive.sourceRoot);
  const environment = {
    ...process.env,
    MACOSX_DEPLOYMENT_TARGET: target.deploymentTarget,
  };
  await run(
    "make",
    ["-j", String(Math.max(1, Math.min(cpus().length, 8))), ...gitMakeOptions],
    { cwd: sourceRoot, env: environment },
  );
  await run("make", [...gitMakeOptions, `DESTDIR=${runtimeRoot}`, "install"], {
    cwd: sourceRoot,
    env: environment,
  });
  const caBundle = await cachedSource(cacheRoot, target.caBundle);
  await mkdir(dirname(join(runtimeRoot, target.caBundlePath)), {
    recursive: true,
  });
  await copyFile(caBundle, join(runtimeRoot, target.caBundlePath));
  await mkdir(join(runtimeRoot, "licenses"), { recursive: true });
  await copyFile(
    join(sourceRoot, "COPYING"),
    join(runtimeRoot, "licenses", "Git-COPYING"),
  );
  await writeFile(
    join(runtimeRoot, "licenses", "NOTICE.txt"),
    [
      "Git is distributed under GPL-2.0 with compatible licenses for some components.",
      "Source: https://www.kernel.org/pub/software/scm/git/",
      "CA bundle: Mozilla certificates distributed by curl; see https://curl.se/docs/caextract.html",
      "",
    ].join("\n"),
    "utf8",
  );
  await materializeRequiredFileLinks(runtimeRoot, target.requiredPaths);
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const platform = args.platform ?? process.platform;
  const arch = args.arch ?? process.arch;
  const manifestPath = resolve(args.manifest ?? defaultManifestPath);
  const outputRoot = resolve(
    args.output ?? join(repositoryRoot, "apps", "desktop", "resources", "git"),
  );
  const cacheRoot = resolve(
    args.cache ?? join(repositoryRoot, ".cache", "git-runtime"),
  );
  if (basename(outputRoot) !== "git") {
    throw new Error("The runtime output directory must be named git.");
  }
  const manifest = await loadManifest(manifestPath);
  const { key, target } = selectTarget(manifest, platform, arch);
  try {
    await verifyRuntime(outputRoot, manifest, key, target);
    process.stdout.write(
      `Git runtime ${key} ${target.version} is already ready.\n`,
    );
    return;
  } catch (error) {
    try {
      await access(outputRoot);
      throw new Error(
        `Existing runtime at ${outputRoot} is invalid; remove it before fetching ${key}.`,
        { cause: error },
      );
    } catch (accessError) {
      if (
        !(accessError instanceof Error) ||
        !("code" in accessError) ||
        accessError.code !== "ENOENT"
      ) {
        throw accessError;
      }
    }
  }

  const archivePath = await cachedSource(cacheRoot, target.archive);
  await mkdir(dirname(outputRoot), { recursive: true });
  const workRoot = await mkdtemp(join(dirname(outputRoot), ".git-runtime-"));
  const runtimeRoot =
    target.distribution === "source-build"
      ? join(workRoot, "runtime")
      : workRoot;
  try {
    if (target.distribution === "source-build") {
      await mkdir(runtimeRoot);
      await buildMacRuntime(
        target,
        archivePath,
        cacheRoot,
        workRoot,
        runtimeRoot,
      );
    } else {
      await extractArchive(archivePath, runtimeRoot);
    }
    await writeFile(
      join(runtimeRoot, manifest.metadataFile),
      `${JSON.stringify(runtimeMetadata(manifest, key, target), undefined, 2)}\n`,
      "utf8",
    );
    await verifyRuntime(runtimeRoot, manifest, key, target);
    await rename(runtimeRoot, outputRoot);
    process.stdout.write(`Prepared Git runtime ${key} ${target.version}.\n`);
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

await main();
