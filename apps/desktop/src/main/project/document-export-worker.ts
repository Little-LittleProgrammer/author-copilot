import { parentPort, workerData } from "node:worker_threads";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { ProjectExportFormat } from "@author-copilot/contracts";
import type { ManuscriptSnapshot } from "./document-export.js";

export async function renderManuscript(
  snapshot: ManuscriptSnapshot,
  format: ProjectExportFormat,
): Promise<Buffer> {
  if (format !== "docx") {
    const text = snapshot.blocks
      .map((block) =>
        block.kind === "heading" && format === "md"
          ? `${"#".repeat(block.level ?? 1)} ${block.text.replace(/[\\`*_[\]<>#]/gu, "\\$&")}`
          : block.text,
      )
      .join("\n\n");
    return Buffer.from(`${text}\n`, "utf8");
  }
  const headings = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
  ] as const;
  const paragraphs = snapshot.blocks.flatMap((block) => {
    if (block.kind === "heading")
      return [
        new Paragraph({
          text: block.text,
          heading: headings[(block.level ?? 1) - 1] ?? HeadingLevel.HEADING_1,
          pageBreakBefore: block.pageBreak ?? false,
          keepNext: true,
          spacing: { before: 240, after: 180 },
        }),
      ];
    return block.text.split("\n").map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line })],
          spacing: { after: 120, line: 360 },
        }),
    );
  });
  return Packer.toBuffer(
    new Document({
      title: snapshot.title,
      creator: "Author Copilot",
      styles: { default: { document: { run: { font: "宋体", size: 24 } } } },
      sections: [
        {
          properties: {
            page: {
              size: { width: 11906, height: 16838 },
              margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
            },
          },
          children: paragraphs,
        },
      ],
    }),
  );
}

if (parentPort !== null) {
  const port = parentPort;
  const { snapshot, format } = workerData as {
    snapshot: ManuscriptSnapshot;
    format: ProjectExportFormat;
  };
  void renderManuscript(snapshot, format)
    .then((bytes) => port.postMessage(bytes))
    .catch(() => port.postMessage(null));
}
