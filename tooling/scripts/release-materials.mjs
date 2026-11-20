import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = join(root, "apps/desktop/resources/release-materials");
mkdirSync(output, { recursive: true });
const components = new Map();
const notices = [];
const review = [];
if (!existsSync(join(root, "LICENSE")))
  review.push("Application distribution license is not defined.");

function locate(name, from) {
  let directory = from;
  while (true) {
    const candidate = join(directory, "node_modules", name);
    if (existsSync(join(candidate, "package.json")))
      return realpathSync(candidate);
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error(`Missing installed production dependency: ${name}`);
    directory = parent;
  }
}

function visit(directory) {
  const manifest = JSON.parse(
    readFileSync(join(directory, "package.json"), "utf8"),
  );
  const id = `${manifest.name}@${manifest.version}`;
  if (components.has(id)) return;
  const license =
    typeof manifest.license === "string"
      ? manifest.license
      : manifest.license?.type;
  const component = {
    type: "library",
    "bom-ref": id,
    name: manifest.name,
    version: manifest.version,
    ...(license ? { licenses: [{ license: { name: license } }] } : {}),
  };
  components.set(id, component);
  let found = false;
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (
      /^(licen[sc]e|copying|notice)([.\-_]|$)/iu.test(name) &&
      statSync(path).isFile()
    ) {
      notices.push(
        `\n===== ${id} / ${name} =====\n${readFileSync(path, "utf8")}\n`,
      );
      found = true;
    }
  }
  if (
    (!license ||
      !found ||
      /SEE LICENSE|UNLICENSED|PROPRIETARY/iu.test(license)) &&
    !manifest.name.startsWith("@author-copilot/")
  )
    review.push(id);
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  };
  for (const name of Object.keys(dependencies ?? {})) {
    try {
      visit(locate(name, directory));
    } catch (error) {
      if (
        manifest.optionalDependencies?.[name] &&
        String(error.message).startsWith("Missing installed")
      )
        continue;
      throw error;
    }
  }
}

visit(join(root, "apps/desktop"));
// Electron and Chromium are distributed runtimes even though electron is a dev dependency.
const electron = locate("electron", join(root, "apps/desktop"));
const electronManifest = JSON.parse(
  readFileSync(join(electron, "package.json"), "utf8"),
);
components.set(`electron@${electronManifest.version}`, {
  type: "framework",
  "bom-ref": `electron@${electronManifest.version}`,
  name: "electron",
  version: electronManifest.version,
  licenses: [{ license: { name: "MIT and third-party notices" } }],
});
for (const name of ["LICENSE", "LICENSES.chromium.html"]) {
  const path = join(electron, "dist", name);
  if (existsSync(path))
    notices.push(
      `\n===== Electron / ${name} =====\n${readFileSync(path, "utf8")}\n`,
    );
  else review.push(`Electron runtime missing ${name}`);
}
const gitManifest = JSON.parse(
  readFileSync(join(root, "tooling/git-runtime-manifest.json"), "utf8"),
);
for (const [target, runtime] of Object.entries(gitManifest.targets)) {
  components.set(`git-${target}@${runtime.version}`, {
    type: "application",
    "bom-ref": `git-${target}@${runtime.version}`,
    name: `git-${target}`,
    version: runtime.version,
    licenses: [
      { license: { name: "GPL-2.0 and bundled third-party notices" } },
    ],
    properties: [
      { name: "sourceArchive.sha256", value: runtime.archive.sha256 },
    ],
  });
}
// Bundle the entire pinned runtime manifest; platform-specific license files are
// preserved inside resources/git by the existing fetch/verify scripts.
writeFileSync(
  join(output, "git-runtime-manifest.json"),
  JSON.stringify(gitManifest, null, 2) + "\n",
);
const lockHash = createHash("sha256")
  .update(readFileSync(join(root, "pnpm-lock.yaml")))
  .digest("hex");
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: "application",
      name: "Author Copilot",
      version: JSON.parse(
        readFileSync(join(root, "apps/desktop/package.json"), "utf8"),
      ).version,
    },
    properties: [{ name: "pnpm-lock.sha256", value: lockHash }],
  },
  components: [...components.values()].sort((a, b) =>
    a["bom-ref"].localeCompare(b["bom-ref"]),
  ),
};
writeFileSync(
  join(output, "sbom.cdx.json"),
  JSON.stringify(sbom, null, 2) + "\n",
);
writeFileSync(join(output, "THIRD-PARTY-NOTICES.txt"), notices.join("\n"));
writeFileSync(
  join(output, "license-review.json"),
  JSON.stringify(
    {
      reviewRequired: review,
      scope:
        "Installed desktop production dependency tree, Electron/Chromium and pinned Git manifest. Git runtime license texts are distributed in resources/git. Review application licensing, binary-specific notices, proprietary dependencies and redistribution obligations before public release.",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Generated release materials for ${components.size} components; ${review.length} entries require license review.`,
);
