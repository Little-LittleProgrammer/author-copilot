from __future__ import annotations

import hashlib
from typing import Iterable

from .contracts import Chunk, SourceDocument


def chunk_markdown(document: SourceDocument, max_chars: int = 900) -> list[Chunk]:
    """Split at blank lines while preserving 1-based source line ranges."""
    lines = document.content.splitlines()
    blocks: list[tuple[int, int, str]] = []
    block_start: int | None = None
    block_lines: list[str] = []

    def flush(end_line: int) -> None:
        nonlocal block_start, block_lines
        if block_start is not None and block_lines:
            blocks.append((block_start, end_line, "\n".join(block_lines)))
        block_start = None
        block_lines = []

    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            flush(line_number - 1)
            continue
        if block_start is None:
            block_start = line_number
        block_lines.append(line)
    flush(len(lines))

    chunks: list[Chunk] = []
    pending: list[tuple[int, int, str]] = []
    pending_chars = 0
    for block in blocks:
        block_size = len(block[2])
        if pending and pending_chars + block_size + 1 > max_chars:
            chunks.append(_make_chunk(document, pending))
            pending = []
            pending_chars = 0
        pending.append(block)
        pending_chars += block_size + 1
    if pending:
        chunks.append(_make_chunk(document, pending))
    return chunks


def chunk_documents(documents: Iterable[SourceDocument]) -> list[Chunk]:
    return [chunk for document in documents for chunk in chunk_markdown(document)]


def _make_chunk(document: SourceDocument, blocks: list[tuple[int, int, str]]) -> Chunk:
    start_line = blocks[0][0]
    end_line = blocks[-1][1]
    content = "\n\n".join(block[2] for block in blocks)
    identity = f"{document.project_id}\0{document.source_path}\0{start_line}\0{end_line}"
    chunk_id = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
    return Chunk(
        project_id=document.project_id,
        source_path=document.source_path,
        chunk_id=chunk_id,
        start_line=start_line,
        end_line=end_line,
        content=content,
    )

