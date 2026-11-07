/** Literal, case-sensitive matches; replacement text is never interpreted as a pattern. */
export function findTextMatches(content: string, query: string): number[] {
  if (query.length === 0) return [];
  const matches: number[] = [];
  let from = 0;
  while (from <= content.length - query.length) {
    const index = content.indexOf(query, from);
    if (index < 0) break;
    matches.push(index);
    from = index + query.length;
  }
  return matches;
}

/** Format prose paragraphs, leaving Markdown blocks and their whitespace intact. */
export function formatManuscript(content: string): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const blocks = content.replace(/\r\n/gu, "\n").split(/(\n[ \t]*\n)/u);
  let fence: string | undefined;
  return blocks
    .map((block, index) => {
      if (index % 2 === 1) return block;
      const lines = block.split("\n");
      let structured = fence !== undefined;
      for (const line of lines) {
        const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
        if (marker !== undefined) {
          structured = true;
          if (fence === undefined) fence = marker;
          else if (marker[0] === fence[0] && marker.length >= fence.length)
            fence = undefined;
        }
        if (
          /^(?: {4}|\t| {0,3}(?:#{1,6}\s|>|[-+*]\s|\d+[.)]\s|\||<|\[|[-*_]{3,}\s*$|[=-]+\s*$))/u.test(
            line,
          ) ||
          / {2}$|\\$/u.test(line)
        )
          structured = true;
      }
      if (structured) return block;
      return lines
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `　　${line}`)
        .join("\n\n");
    })
    .join("")
    .replace(/\n/gu, newline);
}
