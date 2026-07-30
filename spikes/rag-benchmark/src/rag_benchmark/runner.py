from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
import platform
import sqlite3
import sys
import time
from typing import Any, Callable

from .adapters import LanceDbCandidate, SqliteFts5Adapter
from .chunking import chunk_documents, chunk_markdown
from .contracts import KnowledgeIndexAdapter, SourceDocument
from .fixtures import generate_fixture, load_documents, load_queries
from .formal_fixtures import (
    FORMAL_SCALES,
    generate_formal_fixture,
    load_documents as load_formal_documents,
    load_queries as load_formal_queries,
)


ADAPTERS: dict[str, Callable[..., KnowledgeIndexAdapter]] = {
    "sqlite-fts5": SqliteFts5Adapter,
    "lancedb": LanceDbCandidate,
}


def run_benchmark(
    adapter_name: str,
    work_dir: Path,
    report_path: Path,
    query_repetitions: int = 20,
) -> dict[str, Any]:
    fixture_dir = work_dir / "fixture"
    manifest = generate_fixture(fixture_dir)
    documents = load_documents(fixture_dir)
    queries = load_queries(fixture_dir)
    chunks = chunk_documents(documents)
    database_path = work_dir / f"{adapter_name}.db"
    database_path.unlink(missing_ok=True)

    factory = ADAPTERS[adapter_name]
    adapter = factory(database_path=database_path, project_id=manifest["project_id"])
    try:
        metrics = _measure_candidate(
            adapter,
            fixture_dir,
            documents,
            chunks,
            queries,
            query_repetitions,
        )

        report = {
            "schema_version": 1,
            "classification": "smoke-only",
            "adapter": adapter_name,
            "adapter_config": {"tokenizer": getattr(adapter, "tokenizer", None)},
            "benchmark_parameters": {
                "top_k": 5,
                "query_repetitions": query_repetitions,
                "chunk_max_characters": 900,
            },
            "fixture": manifest,
            "dataset": {
                "characters": sum(len(document.content) for document in documents),
                "documents": len(documents),
                "chunks": len(chunks),
                "labeled_queries": len(queries),
            },
            "metrics": {
                **metrics,
            },
            "environment": {
                "platform": platform.platform(),
                "machine": platform.machine(),
                "python": sys.version.split()[0],
                "sqlite": sqlite3.sqlite_version,
            },
            "formal_exit_gate": {
                "corpus_characters": [100_000, 1_000_000, 5_000_000],
                "minimum_human_labeled_queries": 100,
                "source_path_range_accuracy": 1.0,
                "recall_at_5_minimum": 0.8,
                "one_million_character_query_p95_ms_maximum": 300,
                "satisfied_by_this_report": False,
            },
        }
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        return report
    finally:
        adapter.close()


def run_formal_benchmark(
    adapter_name: str,
    work_dir: Path,
    report_path: Path,
    query_repetitions: int = 20,
) -> dict[str, Any]:
    scale_reports: list[dict[str, Any]] = []
    for scale in FORMAL_SCALES:
        fixture_dir = work_dir / f"fixture-{scale}"
        manifest = generate_formal_fixture(fixture_dir, scale)
        documents = load_formal_documents(fixture_dir)
        queries = load_formal_queries(fixture_dir)
        chunks = chunk_documents(documents)
        database_path = work_dir / f"{adapter_name}-{scale}.db"
        database_path.unlink(missing_ok=True)
        adapter = ADAPTERS[adapter_name](
            database_path=database_path,
            project_id=manifest["project_id"],
        )
        try:
            metrics = _measure_candidate(
                adapter,
                fixture_dir,
                documents,
                chunks,
                queries,
                query_repetitions,
            )
        finally:
            adapter.close()
        scale_reports.append(
            {
                "fixture": manifest,
                "dataset": {
                    "characters": sum(len(document.content) for document in documents),
                    "documents": len(documents),
                    "chunks": len(chunks),
                    "labeled_queries": len(queries),
                },
                "metrics": metrics,
            }
        )

    one_million = next(
        item for item in scale_reports if item["dataset"]["characters"] == 1_000_000
    )
    minimum_recall = min(item["metrics"]["recall_at_5"] for item in scale_reports)
    minimum_accuracy = min(
        item["metrics"]["source_path_range_accuracy"] for item in scale_reports
    )
    engineering_thresholds_passed = (
        minimum_recall >= 0.8
        and minimum_accuracy == 1.0
        and one_million["metrics"]["query_latency_ms"]["p95"] < 300
        and all(
            item["metrics"]["single_file_incremental_verified"]
            for item in scale_reports
        )
    )
    report = {
        "schema_version": 1,
        "classification": "formal-scale-candidate",
        "adapter": adapter_name,
        "adapter_config": {"tokenizer": "trigram"},
        "benchmark_parameters": {
            "top_k": 5,
            "query_repetitions": query_repetitions,
            "chunk_max_characters": 900,
        },
        "scales": scale_reports,
        "environment": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "python": sys.version.split()[0],
            "sqlite": sqlite3.sqlite_version,
        },
        "formal_exit_gate": {
            "required_corpus_characters": list(FORMAL_SCALES),
            "minimum_human_labeled_queries": 100,
            "source_path_range_accuracy": 1.0,
            "recall_at_5_minimum": 0.8,
            "one_million_character_query_p95_ms_maximum": 300,
            "engineering_thresholds_passed": engineering_thresholds_passed,
            "human_label_review_passed": False,
            "satisfied_by_this_report": False,
        },
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return report


def _measure_candidate(
    adapter: KnowledgeIndexAdapter,
    fixture_dir: Path,
    documents: list[SourceDocument],
    chunks: list[Any],
    queries: list[dict[str, Any]],
    query_repetitions: int,
) -> dict[str, Any]:
    started = time.perf_counter_ns()
    adapter.build(chunks)
    first_index_ms = _elapsed_ms(started)
    index_size_bytes = adapter.storage_size_bytes()

    quality = _measure_quality(adapter, fixture_dir, queries)
    latency_samples = _measure_latency(adapter, queries, query_repetitions)

    changed = documents[0]
    marker = "incremental-marker-7f4b9c"
    updated = SourceDocument(
        project_id=changed.project_id,
        source_path=changed.source_path,
        content=changed.content + f"\nIncremental benchmark marker: {marker}.\n",
    )
    started = time.perf_counter_ns()
    adapter.replace_source(updated.source_path, chunk_markdown(updated))
    incremental_ms = _elapsed_ms(started)
    incremental_verified = any(
        hit.source_path == updated.source_path for hit in adapter.search(marker, limit=5)
    )
    return {
        "first_index_ms": round(first_index_ms, 3),
        "index_size_bytes": index_size_bytes,
        "single_file_incremental_ms": round(incremental_ms, 3),
        "single_file_incremental_verified": incremental_verified,
        "query_latency_ms": {
            "samples": len(latency_samples),
            "p50": round(_percentile(latency_samples, 50), 3),
            "p95": round(_percentile(latency_samples, 95), 3),
        },
        **quality,
    }


def _measure_quality(
    adapter: KnowledgeIndexAdapter,
    fixture_dir: Path,
    queries: list[dict[str, Any]],
) -> dict[str, Any]:
    expected_count = 0
    recalled_count = 0
    correct_range_count = 0
    query_results: list[dict[str, Any]] = []
    corpus_dir = fixture_dir / "corpus"

    for query in queries:
        hits = adapter.search(query["query"], limit=5)
        expected = query["expected_sources"]
        expected_count += len(expected)
        recalled_for_query = 0
        correct_for_query = 0
        for source in expected:
            matching_hits = [hit for hit in hits if hit.source_path == source["path"]]
            if matching_hits:
                recalled_count += 1
                recalled_for_query += 1
            expected_line = _line_containing(corpus_dir / source["path"], source["contains"])
            if any(hit.start_line <= expected_line <= hit.end_line for hit in matching_hits):
                correct_range_count += 1
                correct_for_query += 1
        query_results.append(
            {
                "id": query["id"],
                "case": query["case"],
                "expected_sources": len(expected),
                "recalled_sources": recalled_for_query,
                "correct_source_ranges": correct_for_query,
                "top_5": [asdict(hit) for hit in hits],
            }
        )

    return {
        "recall_at_5": round(recalled_count / expected_count, 6),
        "source_path_range_accuracy": round(
            correct_range_count / recalled_count if recalled_count else 0.0,
            6,
        ),
        "quality_denominator_sources": expected_count,
        "source_accuracy_denominator_recalled_sources": recalled_count,
        "query_results": query_results,
    }


def _measure_latency(
    adapter: KnowledgeIndexAdapter,
    queries: list[dict[str, Any]],
    repetitions: int,
) -> list[float]:
    samples: list[float] = []
    for _ in range(repetitions):
        for query in queries:
            started = time.perf_counter_ns()
            adapter.search(query["query"], limit=5)
            samples.append(_elapsed_ms(started))
    return samples


def _line_containing(path: Path, needle: str) -> int:
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if needle in line:
            return number
    raise ValueError(f"Label text {needle!r} not found in {path}")


def _elapsed_ms(started_ns: int) -> float:
    return (time.perf_counter_ns() - started_ns) / 1_000_000


def _percentile(values: list[float], percentile: int) -> float:
    if not values:
        raise ValueError("Cannot calculate percentile of an empty sample")
    ordered = sorted(values)
    rank = (len(ordered) - 1) * percentile / 100
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = rank - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction
