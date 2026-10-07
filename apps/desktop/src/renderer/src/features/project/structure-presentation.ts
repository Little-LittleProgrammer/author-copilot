import type {
  ProjectImportRecognizedNode,
  ProjectStructureNode,
} from "@author-copilot/contracts";
import type { ImportPreviewNode, StructureNode } from "./types.js";

function displayName(name: string): string {
  return name.replace(/^\d{4}-/u, "");
}

function isChapterBody(node: {
  readonly role: string;
  readonly children: readonly {
    readonly displayName: string;
    readonly children: readonly unknown[];
  }[];
}): boolean {
  const child = node.children[0];
  return (
    node.role === "chapter" &&
    node.children.length === 1 &&
    child?.displayName === "01-正文" &&
    child.children.length === 0
  );
}

/** A chapter containing only its body opens directly; paths remain filesystem identities. */
export function presentStructureNode(
  node: ProjectStructureNode,
): StructureNode {
  const body = isChapterBody(node) ? node.children[0] : undefined;
  const path = body?.relativePath ?? node.relativePath;
  const namePrefix = /^\d{4}-/u.exec(node.displayName)?.[0];
  return {
    children: body ? [] : node.children.map(presentStructureNode),
    id: path,
    kind: body || node.kind === "document" ? "document" : "group",
    name: displayName(node.displayName),
    role: node.role,
    path,
    ...(body ? { entryPath: node.relativePath } : {}),
    ...(namePrefix ? { namePrefix } : {}),
  };
}

export function presentImportNode(
  node: ProjectImportRecognizedNode,
): ImportPreviewNode {
  return {
    name: displayName(node.displayName),
    children: isChapterBody(node) ? [] : node.children.map(presentImportNode),
  };
}
