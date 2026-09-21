import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function readConfig(name: string): Promise<Record<string, unknown>> {
  const content = await readFile(
    new URL(`./${name}.json`, import.meta.url),
    "utf8",
  );
  return JSON.parse(content) as Record<string, unknown>;
}

describe("shared TypeScript configs", () => {
  it("keeps browser and Node environments separate", async () => {
    const browser = await readConfig("browser");
    const node = await readConfig("node");

    expect(browser).toMatchObject({
      compilerOptions: { moduleResolution: "Bundler", types: [] },
    });
    expect(node).toMatchObject({
      compilerOptions: { moduleResolution: "NodeNext", types: ["node"] },
    });
  });

  it("enables the React automatic JSX transform", async () => {
    await expect(readConfig("react")).resolves.toMatchObject({
      compilerOptions: { jsx: "react-jsx" },
    });
  });
});
