import { createHash } from "node:crypto";

export interface KnowledgeChunk {
  readonly chunkId: string;
  readonly relativePath: string;
  readonly titleContext: readonly string[];
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
}

const MAX_CHUNK_CHARACTERS = 1_200;
const HEADING_PATTERN = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u;

function chunkId(
  relativePath: string,
  startLine: number,
  endLine: number,
  text: string,
): string {
  return createHash("sha256")
    .update(`${relativePath}\0${startLine}\0${endLine}\0${text}`)
    .digest("hex");
}

function splitParagraph(
  relativePath: string,
  titleContext: readonly string[],
  lines: readonly { readonly line: number; readonly text: string }[],
): readonly KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  let current: { line: number; text: string }[] = [];
  let characterCount = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    const text = current
      .map((entry) => entry.text)
      .join("\n")
      .trim();
    const first = current[0];
    const last = current.at(-1);
    if (text.length > 0 && first !== undefined && last !== undefined) {
      chunks.push({
        chunkId: chunkId(relativePath, first.line, last.line, text),
        relativePath,
        titleContext: [...titleContext],
        startLine: first.line,
        endLine: last.line,
        text,
      });
    }
    current = [];
    characterCount = 0;
  };

  for (const line of lines) {
    if (
      current.length > 0 &&
      characterCount + line.text.length + 1 > MAX_CHUNK_CHARACTERS
    ) {
      flush();
    }

    if (line.text.length <= MAX_CHUNK_CHARACTERS) {
      current.push(line);
      characterCount += line.text.length + 1;
      continue;
    }

    flush();
    for (
      let offset = 0;
      offset < line.text.length;
      offset += MAX_CHUNK_CHARACTERS
    ) {
      const text = line.text
        .slice(offset, offset + MAX_CHUNK_CHARACTERS)
        .trim();
      if (text.length === 0) continue;
      chunks.push({
        chunkId: chunkId(relativePath, line.line, line.line, text),
        relativePath,
        titleContext: [...titleContext],
        startLine: line.line,
        endLine: line.line,
        text,
      });
    }
  }
  flush();
  return chunks;
}

export function chunkMarkdown(
  relativePath: string,
  content: string,
): readonly KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  const headings: string[] = [];
  let paragraph: { line: number; text: string }[] = [];

  const flushParagraph = (): void => {
    chunks.push(...splitParagraph(relativePath, headings, paragraph));
    paragraph = [];
  };

  for (const [index, text] of content.split(/\r?\n/u).entries()) {
    const line = index + 1;
    const heading = HEADING_PATTERN.exec(text);
    if (heading !== null) {
      flushParagraph();
      const level = heading[1]?.length ?? 1;
      const title = heading[2]?.trim();
      if (title === undefined || title.length === 0) continue;
      headings.splice(level - 1);
      headings[level - 1] = title;
      chunks.push({
        chunkId: chunkId(relativePath, line, line, title),
        relativePath,
        titleContext: headings.filter((value) => value !== undefined),
        startLine: line,
        endLine: line,
        text: title,
      });
      continue;
    }
    if (text.trim().length === 0) {
      flushParagraph();
      continue;
    }
    paragraph.push({ line, text });
  }
  flushParagraph();
  return chunks;
}

function searchTerms(value: string): readonly string[] {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  const terms = new Set<string>();
  for (const match of normalized.matchAll(/[\p{Script=Latin}\p{N}\p{M}]+/gu)) {
    if (match[0].length > 1) terms.add(match[0]);
  }
  for (const match of normalized.matchAll(/[\p{Script=Han}]+/gu)) {
    const text = match[0];
    if (text.length === 1) terms.add(text);
    for (let index = 0; index < text.length - 1; index += 1) {
      terms.add(text.slice(index, index + 2));
    }
  }
  if (terms.size === 0 && normalized.trim().length > 0) {
    terms.add(normalized.trim());
  }
  return [...terms];
}

export function scoreKnowledgeChunk(
  chunk: KnowledgeChunk,
  query: string,
): number {
  const normalizedQuery = query.normalize("NFKC").toLocaleLowerCase().trim();
  const normalizedText = chunk.text.normalize("NFKC").toLocaleLowerCase();
  const normalizedTitles = chunk.titleContext
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase();
  const terms = searchTerms(normalizedQuery);
  if (terms.length === 0) return 0;

  let matched = 0;
  let weightedMatches = 0;
  for (const term of terms) {
    const inText = normalizedText.includes(term);
    const inTitle = normalizedTitles.includes(term);
    if (!inText && !inTitle) continue;
    matched += 1;
    weightedMatches += inText ? 1 : 0;
    weightedMatches += inTitle ? 0.45 : 0;
  }
  if (matched === 0) return 0;

  const coverage = matched / terms.length;
  const exact = normalizedText.includes(normalizedQuery)
    ? 0.35
    : normalizedTitles.includes(normalizedQuery)
      ? 0.2
      : 0;
  const density = Math.min(
    0.15,
    weightedMatches / Math.max(20, terms.length * 20),
  );
  return Math.min(1, Number((coverage * 0.65 + exact + density).toFixed(6)));
}
