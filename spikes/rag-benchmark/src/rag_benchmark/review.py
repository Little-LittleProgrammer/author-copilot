from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Callable

from .formal_fixtures import load_queries, query_set_sha256


InputFn = Callable[[str], str]
OutputFn = Callable[[str], None]
NowFn = Callable[[], datetime]
DECISIONS = {"pending", "approved", "rejected"}
INDEPENDENT_HUMAN = "independent_human"


def review_fixture(
    fixture_dir: Path,
    reviewed_by: str,
    *,
    input_fn: InputFn = input,
    output_fn: OutputFn = print,
    now_fn: NowFn = lambda: datetime.now(timezone.utc),
) -> dict[str, Any]:
    reviewer = reviewed_by.strip()
    if not reviewer:
        raise ValueError("The reviewer identity must not be empty")

    queries = load_queries(fixture_dir)
    review_path = fixture_dir / "review-template.json"
    review = _load_review(review_path, queries)
    existing_reviewer = review.get("reviewed_by")
    if existing_reviewer and existing_reviewer != reviewer:
        raise ValueError(
            f"This review belongs to {existing_reviewer!r}, not {reviewer!r}"
        )

    review["reviewed_by"] = reviewer
    review["review_method"] = INDEPENDENT_HUMAN
    review["authorized_by"] = ""
    review["authorization_context"] = ""
    pending = [
        query for query in queries if review["decisions"][query["id"]] == "pending"
    ]
    for position, query in enumerate(pending, start=1):
        source_text = _source_text(fixture_dir, query)
        output_fn("")
        output_fn(f"[{position}/{len(pending)}] {query['id']} ({query['case']})")
        output_fn(f"Query: {query['query']}")
        for source in query["expected_sources"]:
            output_fn(f"Expected source: {source['path']}")
            output_fn(f"Expected evidence: {source['contains']}")
        output_fn("Source text:")
        output_fn(source_text)

        while True:
            choice = input_fn("Decision [a=approve, r=reject, s=skip, q=quit]: ").strip().lower()
            if choice in {"a", "approve"}:
                review["decisions"][query["id"]] = "approved"
                break
            if choice in {"r", "reject"}:
                review["decisions"][query["id"]] = "rejected"
                break
            if choice in {"s", "skip"}:
                break
            if choice in {"q", "quit"}:
                _save_review(review_path, review, now_fn)
                return _summary(review, review_path)
            output_fn("Enter a, r, s, or q.")
        _save_review(review_path, review, now_fn)

    _save_review(review_path, review, now_fn)
    return _summary(review, review_path)


def _load_review(review_path: Path, queries: list[dict[str, Any]]) -> dict[str, Any]:
    review: Any = json.loads(review_path.read_text(encoding="utf-8"))
    if isinstance(review, dict) and review.get("schema_version") == 1:
        review = {
            **review,
            "schema_version": 2,
            "review_method": INDEPENDENT_HUMAN,
            "authorized_by": "",
            "authorization_context": "",
        }
    expected_ids = {query["id"] for query in queries}
    decisions = review.get("decisions") if isinstance(review, dict) else None
    if (
        not isinstance(review, dict)
        or review.get("schema_version") != 2
        or review.get("query_set_sha256") != query_set_sha256(queries)
        or not isinstance(decisions, dict)
        or set(decisions) != expected_ids
        or not set(decisions.values()).issubset(DECISIONS)
    ):
        raise ValueError("The review manifest does not match this fixture")
    return review


def _source_text(fixture_dir: Path, query: dict[str, Any]) -> str:
    corpus_dir = (fixture_dir / "corpus").resolve()
    source_texts: list[str] = []
    for source in query["expected_sources"]:
        source_path = (corpus_dir / source["path"]).resolve()
        try:
            source_path.relative_to(corpus_dir)
        except ValueError as error:
            raise ValueError(f"Review source escapes the corpus: {source['path']}") from error
        text = source_path.read_text(encoding="utf-8")
        if source["contains"] not in text:
            raise ValueError(f"Expected evidence is absent from {source['path']}")
        source_texts.append(text.rstrip())
    return "\n\n".join(source_texts)


def _save_review(review_path: Path, review: dict[str, Any], now_fn: NowFn) -> None:
    counts = Counter(review["decisions"].values())
    review["reviewed_at"] = (
        now_fn().astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        if counts["pending"] == 0
        else ""
    )
    temporary_path = review_path.with_suffix(".tmp")
    temporary_path.write_text(
        json.dumps(review, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    temporary_path.replace(review_path)


def _summary(review: dict[str, Any], review_path: Path) -> dict[str, Any]:
    counts = Counter(review["decisions"].values())
    return {
        "reviewed_by": review["reviewed_by"],
        "reviewed_at": review["reviewed_at"],
        "approved": counts["approved"],
        "rejected": counts["rejected"],
        "pending": counts["pending"],
        "passed": counts["approved"] == len(review["decisions"]),
        "review_manifest": str(review_path),
    }
