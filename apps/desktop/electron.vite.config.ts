import { resolve } from "node:path";

import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          "@author-copilot/contracts",
          "@author-copilot/project-schema",
        ],
      }),
    ],
    build: {
      rolldownOptions: {
        input: resolve(import.meta.dirname, "src/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({ exclude: ["@author-copilot/contracts"] }),
    ],
    build: {
      rolldownOptions: {
        input: resolve(import.meta.dirname, "src/preload/index.ts"),
        output: {
          entryFileNames: "[name].cjs",
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, "src/renderer"),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": resolve(import.meta.dirname, "src/renderer/src"),
        // tw-animate-css v1.4 exports only declare the webpack-style "style"
        // condition, which vite / tailwindcss v4 do not honour when resolving
        // `@import` specifiers. Pin the specifier to the concrete stylesheet
        // so the build works regardless of condition support.
        "tw-animate-css": resolve(
          import.meta.dirname,
          "node_modules/tw-animate-css/dist/tw-animate.css",
        ),
      },
    },
    build: {
      rolldownOptions: {
        input: resolve(import.meta.dirname, "src/renderer/index.html"),
      },
    },
  },
});
