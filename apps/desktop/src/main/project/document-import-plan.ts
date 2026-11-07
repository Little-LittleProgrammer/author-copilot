import { DocumentImportError } from "./document-import.js";
import type {
  InitialProjectDocument,
  ProjectStructureNode,
  ProjectTemplate,
} from "./types.js";

export const MAX_IMPORT_DOCUMENTS = 2000;
const numerals = "0-9零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟";
const chineseHeading = new RegExp(
  `^第\\s*[${numerals}]+\\s*([卷部篇章回节幕场])(?:[ \\t:：、.\\-—]*[^\\r\\n]{0,60})?$`,
  "u",
);
const englishHeading =
  /^(volume|book|part|chapter|act|scene)\s+(?:[0-9]+|[ivxlcdm]+)(?:[ \t.:：\-—]+[^\r\n]{1,60})?$/iu;
const specialHeading = new RegExp(
  `^(?:序章|楔子|引子|序言|前言|引言|尾声|终章|后记|番外(?:[${numerals}]+)?|prologue|epilogue)(?:[ \\t:：、.\\-—]+[^\\r\\n]{1,60})?$`,
  "iu",
);

interface Heading {
  readonly offset: number;
  readonly title: string;
  readonly group: boolean;
}
export interface DocumentImportPlan {
  readonly documents: readonly InitialProjectDocument[];
  readonly structure: readonly ProjectStructureNode[];
  readonly matchedChapterCount: number;
}

function findHeadings(content: string, template: ProjectTemplate): Heading[] {
  const headings: Heading[] = [];
  let offset = 0;
  while (offset < content.length) {
    const newline = content.indexOf("\n", offset);
    const end = newline < 0 ? content.length : newline;
    // Only short, standalone lines qualify. Matching never scans prose across lines.
    if (end - offset <= 100) {
      const title = content
        .slice(offset, end)
        .trim()
        .replace(/^#{1,6}\s+/u, "");
      const normalized = title.normalize("NFKC");
      if (normalized.length <= 80 && !/[。；;“”「」]/u.test(normalized)) {
        const chinese = chineseHeading.exec(normalized);
        const english = englishHeading.exec(normalized);
        if (chinese || english || specialHeading.test(normalized)) {
          const unit = chinese?.[1] ?? english?.[1]?.toLowerCase();
          headings.push({
            offset,
            title,
            group:
              ["卷", "部", "篇", "volume", "book", "part"].includes(
                unit ?? "",
              ) ||
              (template === "screenplay" && (unit === "幕" || unit === "act")),
          });
        }
      }
    }
    if (newline < 0) break;
    offset = newline + 1;
  }
  return headings;
}

function orderedName(index: number, title: string): string {
  const safeTitle =
    Array.from(title.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_"))
      .slice(0, 60)
      .join("")
      .replace(/[. ]+$/u, "")
      .trim() || "正文";
  return `${String(index).padStart(4, "0")}-${safeTitle}`;
}

export function buildDocumentImportPlan(
  content: string,
  template: ProjectTemplate,
  splitChapters = true,
): DocumentImportPlan {
  const headings = splitChapters ? findHeadings(content, template) : [];
  const matchedChapterCount = headings.filter(
    (heading) => !heading.group,
  ).length;
  const groups: {
    title: string;
    chapters: { title: string; content: string }[];
  }[] = [];
  const defaultGroup = template === "novel" ? "第一卷" : "第一幕";
  let group = {
    title: defaultGroup,
    chapters: [] as { title: string; content: string }[],
  };
  let start = 0;
  let chapterTitle: string | undefined;
  let volumePrefix = false;
  let documentCount = 0;
  const flush = (end: number) => {
    if (end <= start) return;
    if (++documentCount > MAX_IMPORT_DOCUMENTS)
      throw new DocumentImportError("too_many_chapters");
    if (!groups.includes(group)) groups.push(group);
    group.chapters.push({
      title: chapterTitle ?? (volumePrefix ? "卷首" : "前言"),
      content: content.slice(start, end),
    });
    start = end;
  };
  if (matchedChapterCount === 0) {
    group.chapters.push({
      title: template === "novel" ? "第一章" : "第一场",
      content,
    });
    groups.push(group);
  } else {
    for (const heading of headings) {
      if (heading.group) {
        // Keep leading whitespace with the next section, and preserve prose before a volume.
        if (
          chapterTitle !== undefined ||
          content.slice(start, heading.offset).trim()
        )
          flush(heading.offset);
        group = { title: heading.title, chapters: [] };
        chapterTitle = undefined;
        volumePrefix = true;
      } else {
        if (
          chapterTitle !== undefined ||
          (!volumePrefix && content.slice(start, heading.offset).trim())
        )
          flush(heading.offset);
        chapterTitle = heading.title;
        volumePrefix = false;
      }
    }
    flush(content.length);
  }

  const documents: InitialProjectDocument[] = [];
  const structure: ProjectStructureNode[] = groups.map((entry, groupIndex) => {
    const groupName = matchedChapterCount
      ? orderedName(groupIndex + 1, entry.title)
      : entry.title;
    return {
      kind: template === "novel" ? "volume" : "act",
      name: groupName,
      relativePath: groupName,
      children: entry.chapters.map((chapter, chapterIndex) => {
        const chapterName = matchedChapterCount
          ? orderedName(chapterIndex + 1, chapter.title)
          : chapter.title;
        const fileName =
          template === "novel"
            ? "01-正文"
            : matchedChapterCount
              ? chapterName
              : "01-第一场";
        const relativePath =
          template === "novel"
            ? `${groupName}/${chapterName}/${fileName}.md`
            : `${groupName}/${fileName}.md`;
        documents.push({ relativePath, content: chapter.content });
        const document = {
          kind: "document" as const,
          name: fileName,
          relativePath,
        };
        return template === "novel"
          ? {
              kind: "chapter" as const,
              name: chapterName,
              relativePath: `${groupName}/${chapterName}`,
              children: [document],
            }
          : document;
      }),
    };
  });
  return { documents, structure, matchedChapterCount };
}
