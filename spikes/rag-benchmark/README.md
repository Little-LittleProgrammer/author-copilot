# Author Copilot RAG candidate benchmark

This spike provides one repeatable harness for local Knowledge Index candidates. It fixes the
fixture, Markdown chunking, adapter contract, quality labels and metric definitions so candidate
engines are compared on the same inputs.

The bundled smoke fixture covers Chinese and English Markdown, long and short chapters, duplicate
titles, cross-file retrieval and near-synonym queries. A second deterministic suite generates the
formal 100,000, 1,000,000 and 5,000,000-character scales with 120 labeled queries. Generated labels
remain explicitly pending until an allowed reviewer approves them, so an unattended run cannot close
the M0 quality gate.

## Run

Python 3.11 or newer is required. The SQLite candidate uses only Python's standard library and a
Python build whose SQLite includes FTS5 with the trigram tokenizer. Trigram is intentional: the
standard `unicode61` tokenizer does not segment continuous Chinese text into useful search terms.

```bash
cd spikes/rag-benchmark
python3 benchmark.py generate --output .work/generated-fixture
python3 -m unittest discover -s tests -v
python3 benchmark.py run \
  --adapter sqlite-fts5 \
  --work-dir .work/sqlite-smoke \
  --report reports/sqlite-fts5-smoke.json

python3 benchmark.py generate --scale 100000 --output .work/formal-100k
python3 benchmark.py run \
  --adapter sqlite-fts5 \
  --formal \
  --work-dir .work/sqlite-formal \
  --report reports/sqlite-fts5-formal-candidate.json
```

Formal generation also writes a schema-v2 `review-template.json`. The default path is an independent
human inspection of every query/source label. A repository owner may instead explicitly delegate the
inspection to a model, in which case the manifest must identify `user_authorized_model`, its reviewer,
the authorizing party and the authorization context. Pass the completed file with
`--label-review <path>`. The run rejects missing authorization, incomplete decisions, invalid
timestamps, unknown/missing query IDs and stale query-set hashes; without a valid manifest the final
gate remains false. The tracked qualification evidence is `reviews/formal-label-review.json`.

Use the interactive reviewer to inspect the canonical source text and record one decision at a time:

```bash
python3 benchmark.py review \
  --fixture .work/formal-100k \
  --reviewed-by "Reviewer Name"
```

The command is the independent-human workflow. It accepts `approve`, `reject`, `skip` and `quit`,
saves atomically after each decision and resumes at pending labels. It locks an in-progress manifest
to one reviewer and timestamps it only after every label has a decision. The formal gate still
requires every decision to be `approved`.

The commands recreate their fixture directory, so repeated runs start from identical bytes. The
report contains the fixture SHA-256 and runtime versions. Generated databases and fixtures stay
under `.work/` and are ignored. Each adapter instance is project-scoped and rejects chunks from a
different project ID.

Trying the reserved LanceDB candidate fails explicitly and emits no metrics:

```bash
python3 benchmark.py run --adapter lancedb
```

`pyproject.toml` records the future, local-only LanceDB dependency range. The adapter must implement
the same contract and pass the same labels before it can produce a benchmark report.

## Metrics

- `first_index_ms`: wall-clock time to create the complete candidate index from fixed chunks.
- `index_size_bytes`: candidate database size after the initial index is committed and compacted.
- `single_file_incremental_ms`: wall-clock time to replace every chunk for one changed Markdown file.
- `single_file_incremental_verified`: an added marker is retrievable from the changed source.
- `query_latency_ms.p50/p95`: latency distribution across every labeled query, repeated 20 times by
  default. Fixture generation, indexing and quality scoring are excluded.
- `recall_at_5`: expected source paths present in the top five, divided by all labeled source paths.
- `source_path_range_accuracy`: recalled labeled sources whose returned source path and line range
  contain the labeled evidence line, divided by recalled labeled sources. Misses belong to
  `recall_at_5`; this metric independently detects incorrect citation metadata.

All paths in labels, results and reports are project-relative. Chunking is engine-independent and
preserves 1-based Markdown line ranges.

## Formal M0 exit gate

The formal comparison must replace this smoke fixture with **100,000, 1,000,000 and 5,000,000
Chinese-character-scale corpora** and at least **100 reviewed labeled queries**. The implementation plan
requires source path/range accuracy of 100%, Recall@5 of at least 80%, and 1,000,000-character query
p95 below 300 ms on the recorded reference device. Single-file updates must also avoid blocking
content saves. Electron packaging stability across macOS and Windows, x64 and arm64 is a separate
required gate.

Every smoke report sets `formal_exit_gate.satisfied_by_this_report` to `false`. Formal-scale
candidate reports separately record engineering thresholds and label review. The generated labels
include 100 identifier/partial-expression cases and 20 pure near-synonym cases that expose the
lexical candidate's expected semantic misses. Every near-synonym query has a distinct paraphrased
color clue, so a reviewer can map it to exactly one labeled source rather than approve an ambiguous
repeated query. The generated cases are useful for regression and performance qualification, but
they cannot satisfy the gate until an allowed reviewer records a complete, hash-bound review.
