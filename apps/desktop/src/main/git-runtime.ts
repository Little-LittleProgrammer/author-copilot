import { join } from "node:path";

export interface GitRuntimeOptions {
  readonly developmentOverride?: string;
  readonly arch: NodeJS.Architecture;
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly resourcesPath: string;
}

export interface ResolvedGitRuntime {
  readonly executable: string;
  readonly environment: Readonly<Record<string, string>>;
}

export function resolveGitRuntime(
  options: GitRuntimeOptions,
): ResolvedGitRuntime {
  if (!options.isPackaged) {
    return {
      executable: options.developmentOverride?.trim() || "git",
      environment: {},
    };
  }

  const runtimeRoot = join(options.resourcesPath, "git");
  const architectureRoot =
    options.platform === "win32"
      ? options.arch === "arm64"
        ? "clangarm64"
        : "mingw64"
      : undefined;
  const runtimePath = (macPath: string, windowsPath: string): string =>
    join(
      runtimeRoot,
      architectureRoot ?? macPath,
      architectureRoot ? windowsPath : "",
    );
  return {
    executable: join(
      runtimeRoot,
      options.platform === "win32" ? "cmd/git.exe" : "bin/git",
    ),
    environment: {
      GIT_EXEC_PATH: runtimePath("libexec/git-core", "libexec/git-core"),
      GIT_SSL_CAINFO: runtimePath(
        "etc/ssl/certs/ca-bundle.crt",
        "etc/ssl/certs/ca-bundle.crt",
      ),
      GIT_TEMPLATE_DIR: runtimePath(
        "share/git-core/templates",
        "share/git-core/templates",
      ),
    },
  };
}
