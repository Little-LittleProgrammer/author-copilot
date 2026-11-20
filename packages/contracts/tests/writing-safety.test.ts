import { describe, expect, it } from "vitest";
import {
  DocumentDraftRequestSchema,
  IPC_INVOKE_CHANNELS,
  IPC_INVOKE_CHANNEL_NAMES,
  IPC_INVOKE_CONTRACTS,
} from "../src/index.js";

describe("writing safety contracts", () => {
  it("registers every declared invoke channel in the allowlist and contract map", () => {
    expect([...IPC_INVOKE_CHANNEL_NAMES].sort()).toEqual(
      Object.values(IPC_INVOKE_CHANNELS).sort(),
    );
    expect(Object.keys(IPC_INVOKE_CONTRACTS).sort()).toEqual(
      Object.values(IPC_INVOKE_CHANNELS).sort(),
    );
  });
  it("requires bounded content and a specific revision before deleting a draft", () => {
    const projectId = "10000000-0000-4000-8000-000000000001";
    expect(
      DocumentDraftRequestSchema.safeParse({
        action: "delete",
        projectId,
        relativePath: "chapter.md",
      }).success,
    ).toBe(false);
    expect(
      DocumentDraftRequestSchema.safeParse({
        action: "put",
        projectId,
        relativePath: "../outside.md",
        baseHash: "a".repeat(64),
        content: "draft",
        revision: projectId,
      }).success,
    ).toBe(false);
    expect(
      DocumentDraftRequestSchema.safeParse({
        action: "put",
        projectId,
        relativePath: "chapter.md",
        baseHash: "a".repeat(64),
        content: "draft",
        revision: projectId,
        executable: "no",
      }).success,
    ).toBe(false);
  });
});
