import { describe, expect, it } from "vitest";

import { baseConfig, nodeConfig, reactConfig } from "./index.js";

/** @param {readonly unknown[]} config */
function mergedGlobals(config) {
  return Object.assign(
    {},
    ...config.map((entry) => {
      if (
        typeof entry !== "object" ||
        entry === null ||
        !("languageOptions" in entry)
      ) {
        return {};
      }

      const { languageOptions } = /** @type {{ languageOptions?: unknown }} */ (
        entry
      );
      if (
        typeof languageOptions !== "object" ||
        languageOptions === null ||
        !("globals" in languageOptions)
      ) {
        return {};
      }

      return languageOptions.globals ?? {};
    }),
  );
}

describe("shared ESLint configs", () => {
  it("exports composable flat configs", () => {
    expect(Array.isArray(baseConfig)).toBe(true);
    expect(Array.isArray(nodeConfig)).toBe(true);
    expect(Array.isArray(reactConfig)).toBe(true);
  });

  it("does not expose Node globals to React code", () => {
    expect(mergedGlobals(nodeConfig)).toHaveProperty("process", "readonly");
    expect(mergedGlobals(reactConfig)).not.toHaveProperty("process");
    expect(mergedGlobals(reactConfig)).not.toHaveProperty("Buffer");
  });
});
