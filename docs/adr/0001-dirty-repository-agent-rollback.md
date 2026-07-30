# ADR-0001: Dirty Repository Agent Snapshot and Rollback

- Status: Accepted; production implementation added in M3, four-architecture qualification pending
- Date: 2026-07-13
- Decision owner: Desktop Git Service / AI Orchestrator
- Related task: M0-05
- Evidence: [`spikes/dirty-repo-rollback`](../../spikes/dirty-repo-rollback/README.md)

## Context

Author Copilot imports existing Git repositories without rewriting their
history or committing pre-import changes. An Agent task can therefore start
while tracked files are staged, unstaged, both staged and unstaged, or while
untracked drafts exist. Restoring a task must remove only Agent-produced
changes and preserve the user's task-start state.

`git stash`, temporary commits, `reset --hard`, and index replacement do not
satisfy that contract. They either create repository-side state, disturb the
user's index, include unrelated files, or cannot safely attribute concurrent
same-file edits.

## Decision

Agent writes use a main-process controlled file service. The service stores a
task snapshot and an append-only mutation ledger under application data,
outside the project repository. Agent SDK tools never receive Git, Shell, or a
general filesystem primitive and never modify `.git`.

The Git index is observed, not copied back or rewritten. The implementation
does not create a stash, commit, ref, tag, worktree, or replacement index. HEAD
and existing history remain unchanged.

### Task-start snapshot

Before granting the one-task capability, the service records:

1. Repository identity, task ID, schema version, creation time, and HEAD OID.
2. Raw porcelain status plus staged, unstaged, and untracked path sets.
3. An empty, durable mutation ledger.

The status snapshot is diagnostic and supplies the review baseline. Restoration
is driven by mutation provenance rather than by assuming every post-snapshot
working-tree difference came from the Agent.

### Controlled mutation ledger

Every Agent write or delete is a compare-and-authorize operation on one
project-relative regular file. Before touching the file, the service persists:

- normalized relative path and monotonic sequence;
- exact before-image (`missing` or content hash, mode, and content-addressed
  blob);
- intended after-image;
- that path's index entry at mutation time;
- parent directories the operation will create;
- `prepared` state.

The file change is then applied atomically and the record becomes `applied`.
This write-ahead order makes crashes before and after the filesystem write
distinguishable. Multiple writes to one file remain separate records so user
edits interleaved between Agent writes are not collapsed into Agent ownership.

Snapshot blobs and journals stay outside the repository and are retained until
the user keeps the result or restoration completes and the review window is
closed. They must be protected with user-only permissions and excluded from
diagnostic uploads because they contain manuscript content.

### Restore algorithm

Restoration processes mutation records in reverse sequence:

1. If HEAD changed, stop automatic restoration for the task. A new commit or
   branch state changes the repository baseline and requires user review.
2. If the affected path's index entry differs from the entry captured for that
   mutation, leave both index and worktree untouched and report a path conflict.
3. If the current file equals the mutation's before-image, mark that mutation
   restored; this makes retries idempotent.
4. If the current file equals the Agent after-image, atomically restore the
   before-image. An unchanged Agent-created file is removed; an Agent-deleted
   file is recreated.
5. If all three states are UTF-8 text files, perform a reverse three-way merge:
   use Agent-after as the merge base, the before-image as one side, and current
   content as the other. A clean merge removes the Agent delta while preserving
   later non-overlapping user edits.
6. For overlapping edits, binary content, or concurrent changes around a file
   creation/deletion, do not modify the path. Report a conflict for manual
   review.
7. Persist `restored` after every successful mutation. A failure blocks earlier
   mutations on the same path but does not prevent independent paths from being
   restored. The retained journal supports an idempotent retry.

Empty directories created solely for an Agent-created file are removed only if
they are still empty. Directories containing later user files are preserved.

### State matrix

| Task-start / later state                            | Restore behavior                                             |
| --------------------------------------------------- | ------------------------------------------------------------ |
| Existing staged change, Agent edits worktree        | Restore exact before-image; leave index unchanged            |
| Existing unstaged change, Agent edits file          | Restore exact before-image                                   |
| Existing staged + unstaged change                   | Restore worktree before-image; staged blob remains unchanged |
| Existing untracked draft, Agent edits it            | Restore untracked before-image                               |
| Agent creates unchanged file                        | Delete file and empty Agent-created parents                  |
| Agent deletes existing file                         | Recreate before-image                                        |
| User later edits a different hunk in same text file | Reverse three-way merge and keep user hunk                   |
| User later edits the same hunk                      | Leave file unchanged and report conflict                     |
| User changes affected index entry                   | Leave index and file unchanged and report conflict           |
| HEAD changes                                        | Block automatic task restore                                 |
| Filesystem write fails partway                      | Persist partial result and retry remaining mutations         |

## Invariants

1. No restore operation rewrites commits, refs, HEAD, or existing history.
2. No Agent operation automatically stages or commits task-start changes.
3. The production Agent has no path that bypasses the controlled mutation
   ledger; otherwise change attribution is not valid.
4. Restore never writes an unresolved conflict marker into the project. A
   conflicted path remains byte-for-byte unchanged.
5. Index drift is never repaired automatically because that would overwrite a
   user staging action.
6. Snapshot loss or corruption disables automatic restore; it must not trigger
   a best-effort `reset`.

## Rejected alternatives

- **Temporary commit:** changes history and risks committing user work.
- **`git stash --include-untracked`:** mutates repository state, affects all
  dirty paths, and has ambiguous recovery when a stash apply conflicts.
- **Copy and restore `.git/index`:** erases staging actions made during the task.
- **`git reset --hard` plus clean:** destroys staged, unstaged, and untracked
  user content.
- **One whole-tree before/after diff:** cannot attribute user edits made during
  the task, especially when they share a file with Agent changes.
- **Always reverse-apply an Agent patch:** may silently corrupt later user edits
  when patch context overlaps or the file was created/deleted.

## Consequences and implementation risks

- All production Agent file tools must route through one main-process service;
  Bash, PowerShell, arbitrary MCP tools, direct SDK file writes, and child
  Agents remain disabled for MVP.
- Snapshot storage can approach the total size written during a task. Production
  must enforce per-task/file budgets, available-disk checks, retention cleanup,
  and content encryption or OS data-protection policy where available.
- A project should have only one active Agent write task. External editors are
  allowed, but overlapping changes surface as review conflicts.
- The prototype uses `git merge-file` from the validated Git runtime. The
  production service must use the bundled executable with argument arrays,
  `shell: false`, timeout/output limits, and cancellation.
- Atomic replacement and file mode behavior require platform tests on Windows
  x64/arm64 and macOS x64/arm64. Symlinks, junctions, devices, UNC escapes, and
  path traversal stay outside the writable capability.
- A clean reverse merge proves textual non-overlap, not authorial intent. The
  change review UI must show every automatically restored and conflicted path.

## Validation

Run:

```bash
node --test spikes/dirty-repo-rollback/rollback.test.mjs
```

The spike creates only temporary repositories and covers:

- exact status and cached-diff preservation for staged, unstaged, mixed, and
  untracked task-start content;
- Agent-created and Agent-deleted files;
- pre-task and post-Agent user edits on the same file;
- non-overlapping reverse merge and overlapping conflict behavior;
- affected-path index drift;
- write-ahead crash recovery;
- partial restore, persisted progress, and retry.

This ADR is ready for project review. Acceptance should unblock M3 production
work, which must port the contract into the Desktop Git/Agent services and
repeat the suite with the bundled Git runtime on all four supported platform
architectures.
