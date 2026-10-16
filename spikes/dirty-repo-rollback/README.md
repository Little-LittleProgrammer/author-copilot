# Dirty Repository Rollback Spike

This spike validates the M0-05 rollback semantics against real temporary Git
repositories. It never targets the source repository and does not run
`git add`, `git commit`, `git stash`, `git reset`, or `git checkout` in the
prototype implementation.

## Run

```bash
node --test spikes/dirty-repo-rollback/rollback.test.mjs
```

The tests create repositories below the operating system temporary directory,
then remove them. The test fixture uses `init`, `add`, and `commit` to construct
dirty-state scenarios. The rollback module itself uses Git only to inspect
repository state and to perform a three-way merge on standalone temporary
files.

## Prototype boundary

- `createTaskSnapshot` records HEAD and the task-start staged, unstaged, and
  untracked classification in external snapshot storage.
- `agentWrite` and `agentDelete` are the only simulated Agent mutation paths.
  They persist a write-ahead mutation record before changing a file.
- `restoreTaskSnapshot` replays mutations in reverse. Exact Agent results are
  replaced with their before-image. Later non-overlapping user edits are kept
  through a reverse three-way merge.
- HEAD drift, per-path index drift, overlapping edits, binary concurrent edits,
  and ambiguous create/delete cases are reported without overwriting the file.
- Restore progress is persisted per mutation, so a partial filesystem failure
  can be retried idempotently.

This is a semantic spike, not the production Electron Git service. Production
work still needs the bundled Git runtime, application-data lifecycle, file-size
budgets, Windows atomic-replace behavior, task locking, and UI conflict review.
