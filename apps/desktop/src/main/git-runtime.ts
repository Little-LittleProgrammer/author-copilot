import { join } from "node:path";

export interface GitRuntimeOptions {
  readonly developmentOverride?: string;
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly resourcesPath: string;
}

export function resolveGitExecutable(options: GitRuntimeOptions): string {
  if (!options.isPackaged) {
    return options.developmentOverride?.trim() || "git";
  }

  return join(
    options.resourcesPath,
    "git",
    options.platform === "win32" ? "cmd/git.exe" : "bin/git",
  );
}
