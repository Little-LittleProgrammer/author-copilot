# M4 Knowledge Index Validation

- Date: 2026-07-30
- Scope: project-local lifecycle, Markdown chunking, source retrieval, cancellation, recovery, and M2 save-event integration
- Status: functional vertical slice implemented; M0 production-engine qualification remains open

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

## Local Evidence

The following checks passed on macOS arm64 with Node 24.16.0 and pnpm 11.7.0:

- Desktop unit/integration suite: 68 tests passed across 11 files.
- Focused Knowledge suite: 8 tests passed.
- Contract suite: 28 tests passed across 4 files.
- Desktop lint: zero errors; four existing Fast Refresh warnings remain.
- Desktop typecheck and Electron main/preload/renderer production build passed.
- Electron E2E: 8 workflows passed, including initialization, search, source-line display, and navigation back to the current document.

The focused Knowledge tests cover:

- heading/paragraph chunking and exact line ranges;
- initialization and project-isolated persistence;
- cancellation without publishing a partial ready index;
- failed-scan retry;
- interrupted-process state recovery;
- asynchronous save-event incremental update;
- external file change detection and complete rebuild;
- rejection of index reuse when the same project ID resolves to another root.

Visual evidence is stored at `apps/desktop/test-results/m4-knowledge-index.png`.

## Open Exit Conditions

This slice does not close M4. The repository's M0 benchmark explicitly states that the current SQLite FTS5 smoke fixture cannot approve a production retrieval engine. The required 100,000/1,000,000/5,000,000-character corpora, at least 100 human-labelled queries, Recall@5 threshold, one-million-character p95 target, and four-architecture Electron packaging evidence for the selected engine remain absent.

The current deterministic lexical index is suitable for validating M4 lifecycle, security boundaries, source accuracy, and user workflow. It must not be presented as the approved production RAG engine or as evidence that the formal quality and performance thresholds have passed.
