# ADR-0002: Local Knowledge Retrieval Backend

- Status: Accepted and qualified for the MVP lexical baseline
- Date: 2026-07-30
- Decision owner: Desktop Knowledge Service
- Related tasks: M0-02, M4
- Evidence: [`spikes/rag-benchmark`](../../spikes/rag-benchmark/README.md), [`docs/reports/m4/2026-07-30-knowledge-index.md`](../reports/m4/2026-07-30-knowledge-index.md)

## Context

M4 needs project-isolated local retrieval with exact source locations, atomic rebuilds, incremental
document updates, bounded search and four-architecture Electron packaging. M0 also requires one
repeatable harness across 100,000, 1,000,000 and 5,000,000-character corpora, at least 100 reviewed
labeled queries, Recall@5 of at least 80%, source path/range accuracy of 100%, and a
1,000,000-character p95 below 300 ms on a recorded reference device.

The first M4 vertical slice used a deterministic in-memory lexical scan over a JSON index. That
proved lifecycle and source contracts, but it was not an approved production retrieval engine and
performed work proportional to every stored chunk on each query.

## Decision

The MVP production baseline uses SQLite FTS5 with the `trigram` tokenizer through Electron's built-in
`node:sqlite` module. It is an explicitly lexical full-text backend, not an embedding or semantic RAG
engine. The product may describe it as local full-book search and source retrieval; it must not claim
semantic understanding.

Each project keeps one search database under Electron `userData/knowledge-indexes/<projectId>`. The
renderer cannot supply the storage path, backend, tokenizer or raw FTS expression. Main converts the
bounded user query into quoted tokens, verifies the database project/index identity, searches in
read-only mode, then re-hashes every returned source before releasing a hit.

Full builds create a user-only temporary database, insert chunks in cancellable batches and rename it
into place only after FTS publication succeeds. Single-document saves transactionally delete and
replace only that source's rows and advance the database index version. The JSON document manifest
remains the lifecycle and integrity record. A missing database or a database/manifest version mismatch
makes the index `stale`; the user rebuilds instead of receiving results from mixed generations.

No separate SQLite native module, LanceDB binary, embedding runtime or model asset is added to the
package. CI invokes the actual Electron executable with `ELECTRON_RUN_AS_NODE=1` and proves that its
embedded SQLite can create and query a trigram FTS5 table on each supported architecture.

## Benchmark Decision

The deterministic formal-scale candidate run on macOS arm64 used Python 3.14.6 and SQLite 3.53.4:

| Characters | Documents | Chunks | First index | Index size | Incremental update | Query p95 | Recall@5 | Source accuracy |
| ---------- | --------- | ------ | ----------- | ---------- | ------------------ | --------- | -------- | --------------- |
| 100,000    | 125       | 237    | 7.276 ms    | 0.49 MiB   | 2.178 ms           | 0.170 ms  | 83.33%   | 100%            |
| 1,000,000  | 170       | 1,400  | 64.562 ms   | 4.29 MiB   | 2.949 ms           | 0.226 ms  | 83.33%   | 100%            |
| 5,000,000  | 368       | 6,568  | 378.652 ms  | 21.15 MiB  | 5.564 ms           | 0.371 ms  | 83.33%   | 100%            |

The 120 generated labels have unique query texts and deliberately include 20 pure near-synonym
queries that lexical FTS does not answer. Each near-synonym query uses a distinct paraphrased color
clue that maps to exactly one source, avoiding ambiguous repeated labels. This makes the 83.33% result
an explicit baseline rather than a semantic-search claim.

Formal fixture generation emits a review manifest bound to the query-set SHA-256. Independent human
review remains the default. On 2026-07-31, the repository owner explicitly delegated the 120-label
inspection to OpenAI Codex. The model-assisted review checked all 100 identifier labels and all 20
Chinese/English near-synonym relationships, found no label errors and approved every query. The
tracked manifest records `user_authorized_model`, the reviewer, authorization context and timestamp;
it does not claim to be independent human review.

The benchmark accepts either allowed review method only when every expected query ID is approved by
a named reviewer with a timezone-qualified timestamp. Model-assisted review additionally requires
the authorizing party and authorization context. Missing, extra, pending, unauthorized or stale
decisions fail closed. The reviewed formal report passes the complete M0/M4 quality gate with 120
approved labels, 83.33% Recall@5, 100% source accuracy and a 0.611 ms p95 at 1,000,000 characters.
Evidence is stored in `spikes/rag-benchmark/reviews/formal-label-review.json` and
`spikes/rag-benchmark/reports/sqlite-fts5-formal-reviewed.json`.

## Four-Architecture Qualification

[Desktop package matrix run 30640904457](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30640904457)
passed against commit `dd31e9b2df9731b8854fd15810f1117c9f5dbfd0`. Every job packaged and uploaded
the target artifact, then ran the Electron SQLite FTS5 qualification and the existing bundled Git,
production-service, HTTPS/SSH, credential and enterprise CA suites.

| Target        | Job                                                                                                                           | Electron | Node    | SQLite | FTS5 trigram |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ------ | ------------ |
| macOS arm64   | [91190290578](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30640904457/job/91190290578) | 43.1.0   | 24.18.0 | 3.53.1 | passed       |
| macOS x64     | [91190290562](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30640904457/job/91190290562) | 43.1.0   | 24.18.0 | 3.53.1 | passed       |
| Windows arm64 | [91190290582](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30640904457/job/91190290582) | 43.1.0   | 24.18.0 | 3.53.1 | passed       |
| Windows x64   | [91190290460](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30640904457/job/91190290460) | 43.1.0   | 24.18.0 | 3.53.1 | passed       |

[Quality run 30640904304](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30640904304)
passed formatting, boundaries, lint, typecheck, the root-integrated RAG benchmark tests, workspace
tests, builds and Electron E2E at commit `dd31e9b`. This run includes the schema-v2 review validator,
the tracked authorization manifest and the reviewed formal report.
Windows ARM64 packaged UI startup remains the separately documented M1-04 gap; this run does prove
that the native Windows ARM64 Electron executable can load `node:sqlite`, create FTS5/trigram data and
query it, and that the Windows ARM64 artifact packages successfully.

## Rejected Alternatives

- **Keep the JSON linear scan:** it preserves contracts but query cost grows with every chunk and the
  stored data is not a production search index.
- **LanceDB or another vector database now:** no local embedding/model distribution decision, formal
  quality report or four-architecture Electron evidence exists. Adding it would introduce an
  unqualified native/runtime surface without proving better MVP acceptance results.
- **Remote embeddings:** manuscripts are local by default and M4 must work without credentials or a
  network. Remote retrieval would change the privacy and offline contract.
- **A hand-rolled semantic synonym map:** it would optimize the benchmark rather than establish a
  general retrieval capability.

## Consequences

- Exact and partial lexical evidence is fast, deterministic and source-addressable.
- Pure paraphrases can miss. M5 must treat absent retrieval as absent context and must not imply that a
  whole-book semantic search occurred.
- Existing ready JSON-only indexes migrate safely by becoming `stale`; a rebuild creates FTS5 data.
- A future hybrid/vector backend must preserve the typed IPC, lifecycle, project identity, source hash,
  line range and index version contracts and must pass this same benchmark plus packaging gates.
- The Python candidate harness and Electron production runtime use the same SQLite FTS5/trigram design,
  but their measured versions are recorded separately. Four-architecture Electron qualification is
  capability and packaging evidence, not a claim that every runner reproduced the reference-device
  latency values.
