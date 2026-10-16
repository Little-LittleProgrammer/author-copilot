export interface DiffLine {
  type: "equal" | "add" | "remove";
  text: string;
  before?: number;
  after?: number;
}

export function splitDiff(
  lines: readonly DiffLine[],
): { left?: DiffLine; right?: DiffLine }[] {
  const rows: { left?: DiffLine; right?: DiffLine }[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.type === "equal") {
      rows.push({ left: line, right: line });
      index++;
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (index < lines.length && lines[index]!.type !== "equal") {
      const change = lines[index++]!;
      (change.type === "remove" ? removed : added).push(change);
    }
    for (let i = 0; i < Math.max(removed.length, added.length); i++)
      rows.push({
        ...(removed[i] ? { left: removed[i] } : {}),
        ...(added[i] ? { right: added[i] } : {}),
      });
  }
  return rows;
}

export function lineDiff(
  before: string | null,
  after: string | null,
): DiffLine[] {
  const left = before === null || before === "" ? [] : before.split("\n");
  const right = after === null || after === "" ? [] : after.split("\n");
  let prefix = 0;
  while (
    prefix < left.length &&
    prefix < right.length &&
    left[prefix] === right[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  )
    suffix++;
  const rows: DiffLine[] = left.slice(0, prefix).map((text, index) => ({
    type: "equal",
    text,
    before: index + 1,
    after: index + 1,
  }));
  const a = left.slice(prefix, left.length - suffix);
  const b = right.slice(prefix, right.length - suffix);
  let i = 0;
  let j = 0;
  // Bound work for large chapters. The fallback still reconstructs both texts exactly.
  const table =
    a.length * b.length <= 250_000
      ? Array.from(
          { length: a.length + 1 },
          () => new Uint32Array(b.length + 1),
        )
      : undefined;
  if (table) {
    for (let x = a.length - 1; x >= 0; x--)
      for (let y = b.length - 1; y >= 0; y--) {
        table[x]![y] =
          a[x] === b[y]
            ? table[x + 1]![y + 1]! + 1
            : Math.max(table[x + 1]![y]!, table[x]![y + 1]!);
      }
  }
  while (i < a.length || j < b.length) {
    if (table && i < a.length && j < b.length && a[i] === b[j]) {
      rows.push({
        type: "equal",
        text: a[i]!,
        before: prefix + ++i,
        after: prefix + ++j,
      });
    } else if (
      j < b.length &&
      (i === a.length || (table && table[i]![j + 1]! > table[i + 1]![j]!))
    ) {
      rows.push({ type: "add", text: b[j]!, after: prefix + ++j });
    } else {
      rows.push({ type: "remove", text: a[i]!, before: prefix + ++i });
    }
  }
  for (let k = 0; k < suffix; k++)
    rows.push({
      type: "equal",
      text: left[left.length - suffix + k]!,
      before: left.length - suffix + k + 1,
      after: right.length - suffix + k + 1,
    });
  return rows;
}
