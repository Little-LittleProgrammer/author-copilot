# M4 Knowledge Index Validation

- Date: 2026-07-30
- Scope: project-local lifecycle, Markdown chunking, source retrieval, cancellation, recovery, and M2 save-event integration
- Status: complete; SQLite FTS5 production baseline implemented, label-reviewed and four-architecture qualified

## Implemented Slice

- Knowledge state and index data are stored under the Electron `userData` directory at `knowledge-indexes/<projectId>`, never inside the writing project or its Git repository.
- State and index publication use atomic user-only files. A rebuild keeps the previous complete index until the replacement is ready.
- The four-state lifecycle supports `not_initialized`, `updating`, `ready`, and `stale`. An interrupted `updating` state recovers to `stale` when a prior index exists, otherwise to `not_initialized`.
- Markdown is split at heading and paragraph boundaries. Every chunk preserves the project-relative source path, heading context, one-based line range, content hash, and index version.
- User-started initialization and rebuild operations expose bounded progress and cancellation through typed IPC. Renderer cannot choose an index path, project root, file path, or backend argument.
- Successful M2 document saves enqueue a non-blocking single-document update. The source hash is reread in Main before the changed document replaces its prior chunks.
- Status reads compare the current document set, file size, modification time, and registered root identity with the persisted index. Unsafe external changes move the index to `stale`.
- Search accepts at most 500 query characters and returns at most 20 bounded source hits. Main rechecks the full source hash for every returned document before releasing a hit to Renderer.
- The AI workspace provides visual initialization confirmation, progress, cancel, retry, rebuild, local search, and source navigation. Internal `.md` storage terminology remains hidden in display text.
- Search now uses Electron's built-in SQLite FTS5 with the `trigram` tokenizer instead of scanning every JSON chunk. Full FTS databases are built in cancellable batches and atomically published; save events transactionally replace only the changed source.
- Existing JSON-only indexes and any database/manifest version mismatch become `stale` and require a safe rebuild.

## Local Evidence

The following checks passed on macOS arm64 with Node 24.16.0 and pnpm 11.7.0:

- Desktop unit/integration suite: 70 tests passed across 11 files.
- Focused Knowledge suite: 10 tests passed.
- Contract suite: 28 tests passed across 4 files.
- Desktop lint: zero errors; four existing Fast Refresh warnings remain.
- Desktop typecheck and Electron main/preload/renderer production build passed.
- Electron E2E: 8 workflows passed, including initialization, search, source-line display, and navigation back to the current document.
- RAG benchmark suite: 9 tests passed, including all three formal corpus scales and fail-closed independent-human/user-authorized-model review paths.
- Electron runtime qualification passed locally on macOS arm64 with Electron 43.1.0, Node 24.18.0 and SQLite 3.53.1.

## CI Evidence

- [Quality run 30640904304](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30640904304) passed formatting, boundaries, lint, typecheck, all 9 root-integrated RAG benchmark tests, workspace tests, builds and all 8 Electron E2E workflows for commit `dd31e9b`.
- [Desktop package matrix run 30640904457](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30640904457) passed macOS x64/arm64 and Windows x64/arm64 packaging and artifact upload for commit `dd31e9b2df9731b8854fd15810f1117c9f5dbfd0`.
- All four matrix jobs passed the Electron SQLite FTS5 runtime check with Electron 43.1.0, Node 24.18.0 and SQLite 3.53.1, including Chinese and English trigram queries.
- All four jobs also passed bundled Git qualification, production Git services, HTTPS/SSH, exact credential, SSH host-fingerprint/private-key and enterprise CA success/rejection paths. [macOS x64](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30640904457/job/91190290562), [macOS arm64](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30640904457/job/91190290578), [Windows x64](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30640904457/job/91190290460) and [Windows arm64](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30640904457/job/91190290582) all succeeded. macOS x64/arm64 and Windows x64 packaged startup passed. Windows ARM64 packaged UI startup remains the intentional M1-04 gap, but its native Electron FTS5 runtime and package artifact both passed.

The focused Knowledge tests cover:

- heading/paragraph chunking and exact line ranges;
- initialization and project-isolated persistence;
- cancellation without publishing a partial ready index;
- failed-scan retry;
- interrupted-process state recovery;
- asynchronous save-event incremental update;
- proof that document save completion does not wait for the incremental index read;
- external file change detection and complete rebuild;
- rejection of index reuse when the same project ID resolves to another root.
- safe degradation when a prior JSON index has no matching SQLite search database.

Visual evidence is stored at `apps/desktop/test-results/m4-knowledge-index.png`.

## Formal Exit Gate

The formal-scale candidate report now covers exact 100,000/1,000,000/5,000,000-character corpora and 120 generated labels. All 120 query texts are unique; each of the 20 pure near-synonym cases uses a distinct paraphrased color clue that maps to exactly one source. On the macOS arm64 reference run, all three scales recorded 83.33% Recall@5 and 100% recalled-source path/range accuracy; the 1,000,000-character query p95 was 0.226 ms. The 20 misses document the lexical baseline's semantic limit. Full results are in `spikes/rag-benchmark/reports/sqlite-fts5-formal-candidate.json` and the backend decision is frozen in ADR-0002.

The repository owner explicitly authorized OpenAI Codex to validate the full label set. The tracked
schema-v2 manifest records that this was a `user_authorized_model` review rather than an independent
human review. All 100 identifier labels and 20 Chinese/English near-synonym labels were checked; all
query IDs, query texts and expected sources are unique, every expected evidence string exists only in
its recorded source, and no label errors were found.

The reviewed formal run passed the complete gate: 120/120 labels approved, engineering thresholds
passed, Recall@5 remained 83.33%, source path/range accuracy remained 100%, and the 1,000,000-character
query p95 was 0.611 ms. The review is bound to query-set SHA-256
`7df68dd2a22ceb6dcc9dcedc667b582e89ecb65f4d7a888ae5e5bf183f512fe2`. Evidence is stored in
`spikes/rag-benchmark/reviews/formal-label-review.json` and
`spikes/rag-benchmark/reports/sqlite-fts5-formal-reviewed.json`. M0's retrieval-quality gate and M4
are complete; the known Windows ARM64 packaged UI startup gap remains owned by M1-04, not M4.
