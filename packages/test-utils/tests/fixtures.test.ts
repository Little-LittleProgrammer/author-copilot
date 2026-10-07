import {
  RuntimeInfoSchema,
  TaskProgressEventSchema,
} from "@author-copilot/contracts";
import { ProjectMetadataV1Schema } from "@author-copilot/project-schema";
import { describe, expect, it } from "vitest";

import {
  createProjectMetadataFixture,
  createRuntimeInfoFixture,
  createTaskProgressFixture,
} from "../src/index.js";

describe("shared test fixtures", () => {
  it("builds schema-valid defaults", () => {
    expect(
      ProjectMetadataV1Schema.safeParse(createProjectMetadataFixture()).success,
    ).toBe(true);
    expect(
      RuntimeInfoSchema.safeParse(createRuntimeInfoFixture()).success,
    ).toBe(true);
    expect(
      TaskProgressEventSchema.safeParse(createTaskProgressFixture()).success,
    ).toBe(true);
  });

  it("accepts typed overrides", () => {
    expect(
      createProjectMetadataFixture({ template: "screenplay" }).template,
    ).toBe("screenplay");
    expect(createRuntimeInfoFixture({ packaged: true }).packaged).toBe(true);
    expect(createTaskProgressFixture({ completed: 5 }).completed).toBe(5);
  });
});
