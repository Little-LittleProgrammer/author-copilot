import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const SUPPORTED_PLATFORMS = new Set(["darwin", "win32"]);
const SUPPORTED_ARCHITECTURES = new Set(["arm64", "x64"]);

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireRelativePath(value, label) {
  const path = requireString(value, label);
  const segments = path.replaceAll("\\", "/").split("/");
  if (
    isAbsolute(path) ||
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new Error(`${label} must stay inside the runtime directory.`);
  }
  return path;
}

function requireSha256(value, label) {
  const sha256 = requireString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return sha256;
}

function parseSource(value, label) {
  const source = requireObject(value, label);
  const url = requireString(source.url, `${label}.url`);
  if (!url.startsWith("https://")) {
    throw new Error(`${label}.url must use HTTPS.`);
  }
  return {
    fileName: requireRelativePath(source.fileName, `${label}.fileName`),
    sha256: requireSha256(source.sha256, `${label}.sha256`),
    url,
    ...(source.sourceRoot === undefined
      ? {}
      : {
          sourceRoot: requireRelativePath(
            source.sourceRoot,
            `${label}.sourceRoot`,
          ),
        }),
  };
}

function parseTarget(value, key) {
  const target = requireObject(value, `targets.${key}`);
  const platform = requireString(target.platform, `targets.${key}.platform`);
  const arch = requireString(target.arch, `targets.${key}.arch`);
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(`targets.${key}.platform is unsupported.`);
  }
  if (!SUPPORTED_ARCHITECTURES.has(arch)) {
    throw new Error(`targets.${key}.arch is unsupported.`);
  }
  if (`${platform}-${arch}` !== key) {
    throw new Error(`targets.${key} does not match its platform and arch.`);
  }
  if (
    !Array.isArray(target.requiredPaths) ||
    target.requiredPaths.length === 0
  ) {
    throw new Error(`targets.${key}.requiredPaths must not be empty.`);
  }
  const distribution = requireString(
    target.distribution,
    `targets.${key}.distribution`,
  );
  if (distribution !== "archive" && distribution !== "source-build") {
    throw new Error(`targets.${key}.distribution is unsupported.`);
  }
  return {
    platform,
    arch,
    version: requireString(target.version, `targets.${key}.version`),
    distribution,
    archive: parseSource(target.archive, `targets.${key}.archive`),
    executable: requireRelativePath(
      target.executable,
      `targets.${key}.executable`,
    ),
    execPath: requireRelativePath(target.execPath, `targets.${key}.execPath`),
    templateDir: requireRelativePath(
      target.templateDir,
      `targets.${key}.templateDir`,
    ),
    caBundlePath: requireRelativePath(
      target.caBundlePath,
      `targets.${key}.caBundlePath`,
    ),
    requiredPaths: target.requiredPaths.map((entry, index) => {
      const required = requireObject(
        entry,
        `targets.${key}.requiredPaths[${index}]`,
      );
      if (required.type !== "file" && required.type !== "directory") {
        throw new Error(
          `targets.${key}.requiredPaths[${index}].type is unsupported.`,
        );
      }
      return {
        path: requireRelativePath(
          required.path,
          `targets.${key}.requiredPaths[${index}].path`,
        ),
        type: required.type,
      };
    }),
    ...(target.caBundle === undefined
      ? {}
      : { caBundle: parseSource(target.caBundle, `targets.${key}.caBundle`) }),
    ...(target.deploymentTarget === undefined
      ? {}
      : {
          deploymentTarget: requireString(
            target.deploymentTarget,
            `targets.${key}.deploymentTarget`,
          ),
        }),
  };
}

export function parseManifest(value) {
  const manifest = requireObject(value, "manifest");
  if (manifest.schemaVersion !== 1) {
    throw new Error("Unsupported Git runtime manifest schema version.");
  }
  const rawTargets = requireObject(manifest.targets, "targets");
  const targets = Object.fromEntries(
    Object.entries(rawTargets).map(([key, target]) => [
      key,
      parseTarget(target, key),
    ]),
  );
  for (const key of [
    "darwin-arm64",
    "darwin-x64",
    "win32-arm64",
    "win32-x64",
  ]) {
    if (targets[key] === undefined) {
      throw new Error(`Git runtime manifest is missing ${key}.`);
    }
  }
  return {
    schemaVersion: 1,
    metadataFile: requireRelativePath(manifest.metadataFile, "metadataFile"),
    targets,
  };
}

export async function loadManifest(manifestPath) {
  return parseManifest(JSON.parse(await readFile(manifestPath, "utf8")));
}

export function selectTarget(manifest, platform, arch) {
  const key = `${platform}-${arch}`;
  const target = manifest.targets[key];
  if (target === undefined) {
    throw new Error(`No Git runtime is configured for ${key}.`);
  }
  return { key, target };
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifySource(path, source) {
  const actual = await sha256File(path);
  if (actual !== source.sha256) {
    throw new Error(
      `SHA-256 mismatch for ${source.fileName}: expected ${source.sha256}, got ${actual}.`,
    );
  }
}

export function validateArchiveEntries(entries) {
  for (const rawEntry of entries) {
    const entry = rawEntry.replaceAll("\\", "/");
    const segments = entry.split("/").filter((segment) => segment.length > 0);
    if (
      entry.startsWith("/") ||
      /^[a-z]:\//iu.test(entry) ||
      segments.some((segment) => segment === "..")
    ) {
      throw new Error(
        `Archive entry escapes the extraction directory: ${rawEntry}`,
      );
    }
  }
}

export function runtimeMetadata(manifest, key, target) {
  return {
    schemaVersion: manifest.schemaVersion,
    target: key,
    platform: target.platform,
    arch: target.arch,
    version: target.version,
    distribution: target.distribution,
    sources: [
      target.archive,
      ...(target.caBundle ? [target.caBundle] : []),
    ].map(({ fileName, sha256, url }) => ({ fileName, sha256, url })),
  };
}

export async function verifyRuntime(runtimeRoot, manifest, key, target) {
  for (const required of target.requiredPaths) {
    const path = join(runtimeRoot, required.path);
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw new Error(
        `Required runtime path cannot be a symlink: ${required.path}`,
      );
    }
    if (
      (required.type === "file" && !stats.isFile()) ||
      (required.type === "directory" && !stats.isDirectory())
    ) {
      throw new Error(
        `Required runtime path has the wrong type: ${required.path}`,
      );
    }
  }
  const actualMetadata = JSON.parse(
    await readFile(join(runtimeRoot, manifest.metadataFile), "utf8"),
  );
  const expectedMetadata = runtimeMetadata(manifest, key, target);
  if (JSON.stringify(actualMetadata) !== JSON.stringify(expectedMetadata)) {
    throw new Error("Git runtime metadata does not match the selected target.");
  }
  return expectedMetadata;
}
