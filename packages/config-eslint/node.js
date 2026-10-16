import { baseConfig } from "./base.js";

const nodeGlobals = Object.fromEntries(
  [
    "AbortController",
    "AbortSignal",
    "Blob",
    "Buffer",
    "URL",
    "URLSearchParams",
    "__dirname",
    "__filename",
    "clearImmediate",
    "clearInterval",
    "clearTimeout",
    "console",
    "exports",
    "fetch",
    "global",
    "module",
    "process",
    "queueMicrotask",
    "require",
    "setImmediate",
    "setInterval",
    "setTimeout",
    "structuredClone",
  ].map((name) => [name, "readonly"]),
);

export const nodeConfig = [
  ...baseConfig,
  {
    name: "author-copilot/node",
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: {
      globals: nodeGlobals,
    },
  },
];

export default nodeConfig;
