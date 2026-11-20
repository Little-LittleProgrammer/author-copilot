from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, Sequence


@dataclass(frozen=True)
class SourceDocument:
    project_id: str
    source_path: str
    content: str


@dataclass(frozen=True)
class Chunk:
    project_id: str
    source_path: str
    chunk_id: str
    start_line: int
    end_line: int
    content: str


@dataclass(frozen=True)
class SearchHit:
    source_path: str
    start_line: int
    end_line: int
    score: float
    snippet: str


class KnowledgeIndexAdapter(Protocol):
    """Minimal candidate contract; chunking stays outside the engine."""

    name: str

    def build(self, chunks: Sequence[Chunk]) -> None: ...

    def replace_source(self, source_path: str, chunks: Sequence[Chunk]) -> None: ...

    def search(self, query: str, limit: int = 5) -> list[SearchHit]: ...

    def storage_size_bytes(self) -> int: ...

    def close(self) -> None: ...


class AdapterUnavailable(RuntimeError):
    def __init__(self, adapter: str, reason: str) -> None:
        super().__init__(reason)
        self.adapter = adapter
        self.reason = reason
