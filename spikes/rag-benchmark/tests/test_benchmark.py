from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from rag_benchmark.chunking import chunk_markdown  # noqa: E402
from rag_benchmark.contracts import SourceDocument  # noqa: E402
from rag_benchmark.fixtures import generate_fixture  # noqa: E402
from rag_benchmark.formal_fixtures import generate_formal_fixture  # noqa: E402
from rag_benchmark.review import review_fixture  # noqa: E402
from rag_benchmark.runner import (  # noqa: E402
    run_benchmark,
    run_formal_benchmark,
    validate_label_review,
)
from rag_benchmark.adapters.sqlite_fts5 import SqliteFts5Adapter  # noqa: E402


class FixtureTests(unittest.TestCase):
    def test_generation_is_byte_for_byte_repeatable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            first = Path(temporary) / "first"
            second = Path(temporary) / "second"
            first_manifest = generate_fixture(first)
            second_manifest = generate_fixture(second)
            self.assertEqual(first_manifest, second_manifest)
            self.assertEqual(_tree_hash(first), _tree_hash(second))

    def test_chunking_preserves_source_lines(self) -> None:
        document = SourceDocument("p1", "chapter.md", "# Title\n\nfirst\nsecond\n\nlast\n")
        chunks = chunk_markdown(document, max_chars=12)
        self.assertEqual(
            [(1, 1), (3, 4), (6, 6)],
            [(chunk.start_line, chunk.end_line) for chunk in chunks],
        )

    def test_formal_scale_fixture_has_exact_size_and_pending_labels(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "formal"
            manifest = generate_formal_fixture(root, 100_000)
            queries = json.loads(
                (root / "queries.json").read_text(encoding="utf-8")
            )
            self.assertEqual(100_000, manifest["characters"])
            self.assertEqual(120, manifest["queries"])
            self.assertTrue(
                all(query["review"]["status"] == "pending" for query in queries)
            )
            self.assertEqual(120, len({query["query"] for query in queries}))
            self.assertEqual(
                20,
                sum(query["case"] == "near-synonym" for query in queries),
            )
            review = json.loads(
                (root / "review-template.json").read_text(encoding="utf-8")
            )
            self.assertEqual(120, len(review["decisions"]))
            self.assertEqual({"pending"}, set(review["decisions"].values()))

    def test_label_review_requires_every_query_and_matching_hash(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "formal"
            generate_formal_fixture(root, 100_000)
            queries = json.loads(
                (root / "queries.json").read_text(encoding="utf-8")
            )
            review_path = root / "review-template.json"
            review = json.loads(review_path.read_text(encoding="utf-8"))
            review.update(
                {
                    "review_method": "independent_human",
                    "reviewed_by": "benchmark-test-reviewer",
                    "reviewed_at": "2026-07-30T10:00:00Z",
                    "decisions": {
                        query_id: "approved" for query_id in review["decisions"]
                    },
                }
            )
            review_path.write_text(json.dumps(review), encoding="utf-8")
            self.assertEqual(
                120,
                validate_label_review(review_path, queries)["approved_queries"],
            )
            review["query_set_sha256"] = "0" * 64
            review_path.write_text(json.dumps(review), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "does not match"):
                validate_label_review(review_path, queries)

    def test_interactive_review_approves_each_label_and_writes_valid_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "formal"
            generate_formal_fixture(root, 100_000)
            decisions = iter(["a"] * 120)
            summary = review_fixture(
                root,
                "independent-test-reviewer",
                input_fn=lambda _: next(decisions),
                output_fn=lambda _: None,
                now_fn=lambda: datetime(2026, 7, 31, 9, 0, tzinfo=timezone.utc),
            )
            self.assertTrue(summary["passed"])
            self.assertEqual(120, summary["approved"])
            self.assertEqual(0, summary["pending"])
            queries = json.loads(
                (root / "queries.json").read_text(encoding="utf-8")
            )
            review = validate_label_review(root / "review-template.json", queries)
            self.assertEqual("independent-test-reviewer", review["reviewed_by"])
            self.assertEqual("2026-07-31T09:00:00Z", review["reviewed_at"])
            self.assertEqual("independent_human", review["review_method"])

    def test_user_authorized_model_review_requires_authorization(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "formal"
            generate_formal_fixture(root, 100_000)
            queries = json.loads(
                (root / "queries.json").read_text(encoding="utf-8")
            )
            review_path = root / "review-template.json"
            review = json.loads(review_path.read_text(encoding="utf-8"))
            review.update(
                {
                    "review_method": "user_authorized_model",
                    "reviewed_by": "test-model",
                    "reviewed_at": "2026-07-31T10:00:00Z",
                    "authorized_by": "test-owner",
                    "decisions": {
                        query_id: "approved" for query_id in review["decisions"]
                    },
                }
            )
            review_path.write_text(json.dumps(review), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "must record its authorization"):
                validate_label_review(review_path, queries)
            review["authorization_context"] = "Explicit test authorization"
            review_path.write_text(json.dumps(review), encoding="utf-8")
            result = validate_label_review(review_path, queries)
            self.assertTrue(result["passed"])
            self.assertEqual("user_authorized_model", result["review_method"])


class SqliteSmokeTests(unittest.TestCase):
    def test_project_scoped_adapter_rejects_cross_project_chunks(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            adapter = SqliteFts5Adapter(Path(temporary) / "index.db", "project-a")
            foreign = SourceDocument("project-b", "chapter.md", "foreign content")
            try:
                with self.assertRaisesRegex(ValueError, "Cross-project"):
                    adapter.build(chunk_markdown(foreign))
            finally:
                adapter.close()

    def test_smoke_report_contains_measured_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            report = run_benchmark(
                adapter_name="sqlite-fts5",
                work_dir=base / "work",
                report_path=base / "report.json",
                query_repetitions=1,
            )
            metrics = report["metrics"]
            self.assertGreater(metrics["first_index_ms"], 0)
            self.assertGreater(metrics["index_size_bytes"], 0)
            self.assertTrue(metrics["single_file_incremental_verified"])
            self.assertEqual(10, report["dataset"]["labeled_queries"])
            self.assertGreaterEqual(metrics["recall_at_5"], 0.8)
            self.assertEqual(1.0, metrics["source_path_range_accuracy"])
            self.assertFalse(report["formal_exit_gate"]["satisfied_by_this_report"])

    def test_formal_report_does_not_pass_without_label_review(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            report = run_formal_benchmark(
                adapter_name="sqlite-fts5",
                work_dir=base / "work",
                report_path=base / "formal-report.json",
                query_repetitions=1,
            )
            self.assertEqual(
                [100_000, 1_000_000, 5_000_000],
                [scale["dataset"]["characters"] for scale in report["scales"]],
            )
            self.assertTrue(report["formal_exit_gate"]["engineering_thresholds_passed"])
            self.assertFalse(report["formal_exit_gate"]["label_review_passed"])
            self.assertFalse(report["formal_exit_gate"]["satisfied_by_this_report"])


def _tree_hash(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


if __name__ == "__main__":
    unittest.main()
