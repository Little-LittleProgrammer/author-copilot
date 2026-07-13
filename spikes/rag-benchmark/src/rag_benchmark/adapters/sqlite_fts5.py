from __future__ import annotations

from pathlib import Path
import re
import sqlite3
from typing import Sequence

from ..contracts import AdapterUnavailable, Chunk, SearchHit


TOKEN_RE = re.compile(r"[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*|[\u3400-\u9fff]+")
ENGLISH_STOP_WORDS = {
    "a",
    "an",
    "at",
    "did",
    "is",
    "it",
    "of",
    "on",
    "the",
    "to",
    "was",
    "were",
    "what",
    "where",
    "which",
    "who",
}


class SqliteFts5Adapter:
    name = "sqlite-fts5"
    tokenizer = "trigram"

    def __init__(self, database_path: Path, project_id: str) -> None:
        self.database_path = database_path
        self.project_id = project_id
        database_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(database_path)
        try:
            self.connection.execute(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
                    project_id UNINDEXED,
                    source_path UNINDEXED,
                    chunk_id UNINDEXED,
                    start_line UNINDEXED,
                    end_line UNINDEXED,
                    content,
                    tokenize = 'trigram'
                )
                """
            )
        except sqlite3.OperationalError as error:
            raise AdapterUnavailable(self.name, f"Python SQLite lacks FTS5: {error}") from error

    def build(self, chunks: Sequence[Chunk]) -> None:
        self._validate_project(chunks)
        with self.connection:
            self.connection.execute("DELETE FROM chunks WHERE project_id = ?", (self.project_id,))
            self.connection.executemany(
                """
                INSERT INTO chunks(
                    project_id, source_path, chunk_id, start_line, end_line, content
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                [_row(chunk) for chunk in chunks],
            )
        self.connection.execute("PRAGMA optimize")
        self.connection.execute("VACUUM")

    def replace_source(self, source_path: str, chunks: Sequence[Chunk]) -> None:
        self._validate_project(chunks)
        if any(chunk.source_path != source_path for chunk in chunks):
            raise ValueError("Replacement chunks must all belong to source_path")
        with self.connection:
            self.connection.execute(
                "DELETE FROM chunks WHERE project_id = ? AND source_path = ?",
                (self.project_id, source_path),
            )
            self.connection.executemany(
                """
                INSERT INTO chunks(
                    project_id, source_path, chunk_id, start_line, end_line, content
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                [_row(chunk) for chunk in chunks],
            )

    def search(self, query: str, limit: int = 5) -> list[SearchHit]:
        fts_query = _fts_query(query)
        if not fts_query:
            return []
        rows = self.connection.execute(
            """
            SELECT source_path, start_line, end_line, bm25(chunks) AS rank,
                   snippet(chunks, 5, '[', ']', ' ... ', 20) AS snippet
            FROM chunks
            WHERE chunks MATCH ? AND project_id = ?
            ORDER BY rank
            LIMIT ?
            """,
            (fts_query, self.project_id, limit),
        ).fetchall()
        return [
            SearchHit(
                source_path=str(row[0]),
                start_line=int(row[1]),
                end_line=int(row[2]),
                score=-float(row[3]),
                snippet=str(row[4]),
            )
            for row in rows
        ]

    def storage_size_bytes(self) -> int:
        self.connection.commit()
        return self.database_path.stat().st_size

    def close(self) -> None:
        self.connection.close()

    def _validate_project(self, chunks: Sequence[Chunk]) -> None:
        if any(chunk.project_id != self.project_id for chunk in chunks):
            raise ValueError("Cross-project chunks are not allowed in a project-scoped index")


def _row(chunk: Chunk) -> tuple[str, str, str, int, int, str]:
    return (
        chunk.project_id,
        chunk.source_path,
        chunk.chunk_id,
        chunk.start_line,
        chunk.end_line,
        chunk.content,
    )


def _fts_query(query: str) -> str:
    tokens = [
        token
        for token in TOKEN_RE.findall(query)
        if token.casefold() not in ENGLISH_STOP_WORDS
    ]
    return " OR ".join(f'"{token.replace(chr(34), chr(34) * 2)}"' for token in tokens)
