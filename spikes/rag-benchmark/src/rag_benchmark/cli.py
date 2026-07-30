from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .contracts import AdapterUnavailable
from .fixtures import generate_fixture
from .formal_fixtures import FORMAL_SCALES, generate_formal_fixture
from .runner import ADAPTERS, run_benchmark, run_formal_benchmark


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Author Copilot RAG candidate benchmark")
    subparsers = parser.add_subparsers(dest="command", required=True)

    generate = subparsers.add_parser("generate", help="generate a deterministic fixture")
    generate.add_argument("--output", type=Path, default=Path(".work/fixture"))
    generate.add_argument(
        "--scale",
        type=int,
        choices=FORMAL_SCALES,
        help="generate a formal-scale synthetic fixture instead of the smoke fixture",
    )

    run = subparsers.add_parser("run", help="run one candidate benchmark")
    run.add_argument("--adapter", choices=sorted(ADAPTERS), default="sqlite-fts5")
    run.add_argument("--work-dir", type=Path, default=Path(".work/run"))
    run.add_argument("--report", type=Path, default=Path("reports/smoke.json"))
    run.add_argument("--query-repetitions", type=int, default=20)
    run.add_argument(
        "--formal",
        action="store_true",
        help="run all three formal scales; generated labels remain pending human review",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "generate":
        manifest = (
            generate_fixture(args.output)
            if args.scale is None
            else generate_formal_fixture(args.output, args.scale)
        )
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
        return 0
    if args.query_repetitions < 1:
        raise SystemExit("--query-repetitions must be at least 1")
    try:
        report = (
            run_formal_benchmark(
                adapter_name=args.adapter,
                work_dir=args.work_dir,
                report_path=args.report,
                query_repetitions=args.query_repetitions,
            )
            if args.formal
            else run_benchmark(
                adapter_name=args.adapter,
                work_dir=args.work_dir,
                report_path=args.report,
                query_repetitions=args.query_repetitions,
            )
        )
    except AdapterUnavailable as error:
        print(
            json.dumps(
                {"adapter": error.adapter, "status": "unavailable", "reason": error.reason},
                ensure_ascii=False,
                indent=2,
            ),
            file=sys.stderr,
        )
        return 2
    if args.formal:
        print(
            json.dumps(
                {
                    "classification": report["classification"],
                    "adapter": report["adapter"],
                    "scales": [
                        {
                            "characters": scale["dataset"]["characters"],
                            "first_index_ms": scale["metrics"]["first_index_ms"],
                            "query_p95_ms": scale["metrics"]["query_latency_ms"]["p95"],
                            "recall_at_5": scale["metrics"]["recall_at_5"],
                            "source_path_range_accuracy": scale["metrics"][
                                "source_path_range_accuracy"
                            ],
                        }
                        for scale in report["scales"]
                    ],
                    "formal_exit_gate": report["formal_exit_gate"],
                    "report": str(args.report),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    metrics = report["metrics"]
    print(
        json.dumps(
            {
                "classification": report["classification"],
                "adapter": report["adapter"],
                "first_index_ms": metrics["first_index_ms"],
                "index_size_bytes": metrics["index_size_bytes"],
                "single_file_incremental_ms": metrics["single_file_incremental_ms"],
                "query_p50_ms": metrics["query_latency_ms"]["p50"],
                "query_p95_ms": metrics["query_latency_ms"]["p95"],
                "recall_at_5": metrics["recall_at_5"],
                "source_path_range_accuracy": metrics["source_path_range_accuracy"],
                "report": str(args.report),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0
