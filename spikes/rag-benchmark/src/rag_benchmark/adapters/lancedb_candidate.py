from __future__ import annotations

from pathlib import Path
from typing import Sequence

from ..contracts import AdapterUnavailable, Chunk, SearchHit


class LanceDbCandidate:
    """Explicit placeholder until a versioned, reviewed implementation exists."""

    name = "lancedb"

    def __init__(self, database_path: Path, project_id: str) -> None:
        raise AdapterUnavailable(
            self.name,
            "LanceDB adapter is a planned candidate only. Install the optional dependency and "
            "implement this contract before collecting metrics; no synthetic results are emitted.",
        )

    def build(self, chunks: Sequence[Chunk]) -> None:
        raise NotImplementedError

    def replace_source(self, source_path: str, chunks: Sequence[Chunk]) -> None:
        raise NotImplementedError

    def search(self, query: str, limit: int = 5) -> list[SearchHit]:
        raise NotImplementedError

    def storage_size_bytes(self) -> int:
        raise NotImplementedError

    def close(self) -> None:
        raise NotImplementedError

