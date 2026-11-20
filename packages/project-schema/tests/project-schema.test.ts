import { describe, expect, it } from "vitest";

import {
  migrateProjectMetadata,
  parseProjectMetadata,
  ProjectMetadataV1Schema,
  UnsupportedProjectSchemaVersionError,
} from "../src/index.js";

const validMetadata = {
  schemaVersion: 1,
  projectId: "10000000-0000-4000-8000-000000000001",
  title: "长夜之后",
  template: "novel",
  createdAt: "2026-07-12T00:00:00.000Z",
} as const;

describe("project metadata schema", () => {
  it("accepts optional portable ordering and rejects malformed or duplicate paths", () => {
    expect(
      parseProjectMetadata({
        ...validMetadata,
        orderedPaths: ["第一卷", "第一卷/第一章"],
      }).orderedPaths,
    ).toEqual(["第一卷", "第一卷/第一章"]);
    for (const orderedPaths of [
      ["../outside"],
      ["/private/work"],
      ["C:/work"],
      [".git/config"],
      ["a\\b"],
      ["第一卷", "第一卷"],
    ]) {
      expect(
        ProjectMetadataV1Schema.safeParse({ ...validMetadata, orderedPaths })
          .success,
      ).toBe(false);
    }
  });
  it.each(["novel", "screenplay"] as const)(
    "accepts the %s template",
    (template) => {
      expect(
        parseProjectMetadata({ ...validMetadata, template }).template,
      ).toBe(template);
    },
  );

  it("rejects unknown fields", () => {
    expect(
      ProjectMetadataV1Schema.safeParse({
        ...validMetadata,
        absolutePath: "/secret",
      }).success,
    ).toBe(false);
  });

  it("rejects malformed IDs and timestamps", () => {
    expect(
      ProjectMetadataV1Schema.safeParse({
        ...validMetadata,
        projectId: "copy-1",
      }).success,
    ).toBe(false);
    expect(
      ProjectMetadataV1Schema.safeParse({
        ...validMetadata,
        createdAt: "today",
      }).success,
    ).toBe(false);
  });
});

describe("project metadata migrations", () => {
  it("returns already-current metadata through the migration entrypoint", () => {
    expect(migrateProjectMetadata(validMetadata)).toEqual(validMetadata);
  });

  it.each([{}, { ...validMetadata, schemaVersion: 2 }])(
    "rejects missing or unsupported schema versions",
    (metadata) => {
      expect(() => migrateProjectMetadata(metadata)).toThrow(
        UnsupportedProjectSchemaVersionError,
      );
    },
  );
});
