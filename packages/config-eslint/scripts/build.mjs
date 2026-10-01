import { cp, mkdir, rm } from "node:fs/promises";

const files = [
  "base.js",
  "index.js",
  "node.js",
  "react.js",
  "index.d.ts",
  "node.d.ts",
  "react.d.ts",
];

await rm(new URL("../dist", import.meta.url), { force: true, recursive: true });
await mkdir(new URL("../dist", import.meta.url), { recursive: true });

await Promise.all(
  files.map((file) =>
    cp(
      new URL(`../${file}`, import.meta.url),
      new URL(`../dist/${file}`, import.meta.url),
    ),
  ),
);
