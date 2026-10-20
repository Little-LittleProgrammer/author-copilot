import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

import { baseConfig } from "./base.js";

const browserGlobals = Object.fromEntries(
  [
    "AbortController",
    "AbortSignal",
    "Blob",
    "CSS",
    "CustomEvent",
    "DOMParser",
    "Document",
    "Element",
    "Event",
    "File",
    "FileReader",
    "FormData",
    "Headers",
    "IntersectionObserver",
    "MutationObserver",
    "Navigator",
    "Node",
    "Request",
    "ResizeObserver",
    "Response",
    "URL",
    "URLSearchParams",
    "WebSocket",
    "Window",
    "cancelAnimationFrame",
    "clearInterval",
    "clearTimeout",
    "console",
    "crypto",
    "document",
    "fetch",
    "localStorage",
    "location",
    "navigator",
    "performance",
    "queueMicrotask",
    "requestAnimationFrame",
    "sessionStorage",
    "setInterval",
    "setTimeout",
    "structuredClone",
    "window",
  ].map((name) => [name, "readonly"]),
);

export const reactConfig = [
  ...baseConfig,
  {
    name: "author-copilot/react",
    files: ["**/*.{jsx,tsx}"],
    languageOptions: {
      globals: browserGlobals,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
];

export default reactConfig;
