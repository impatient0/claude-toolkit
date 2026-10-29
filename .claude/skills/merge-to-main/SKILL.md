---
name: merge-to-main
description: Merge the current session's worktree branch into main, release main immediately, and clean up the worktree — the finish procedure for the session-per-worktree convention. Use ONLY after the user has explicitly said to merge in this conversation; finished-looking work is not a go-ahead. Not for pushing or deploying (never push), and not a checkpoint — that is wrap-up.
---

A session works in its own worktree, and merges its own branch from inside it (see [`CLAUDE.md`'s Version Control](../../../CLAUDE.md#version-control)).
The order matters more than any single command.
Two things here are easy to get subtly wrong and neither fails loudly: holding `main` longer than the merge itself, and cleaning up through `ExitWorktree` with `remove`.

All commands run from inside the worktree unless a step says otherwise.
Worktree isolation refuses `git -C` aimed at another checkout and commands too compound to verify — keep each command plain.

## 0. Preconditions — stop if any fails

- **The user said to merge, in this conversation.** [`CLAUDE.md`](../../../CLAUDE.md#version-control): never merge to `main` without being asked.
  A green suite, a finished slice, or a plan that said "merge at the end" is not the ask.
- **You are in a worktree, not the main checkout:**

  ```bash
  git rev-parse --git-dir --git-common-dir    # the two must differ
  ```

- **Everything is committed:** `git status --short` prints nothing.
- **The branch is green:** run the project's verification gate (e.g. `npm test > <log> 2>&1; echo "exit=$?"`) on the branch itself, exit 0.

Note the branch name now (`git branch --show-current`); you will need it after leaving the branch.

## 1. Take `main`

```bash
git switch main
```

Git refuses to check out a branch that another worktree holds, which makes this step the lock.
If it fails with `already used by worktree at <path>`, another session is merging or died holding `main` — **stop and go to Recovery**; do not detach anything that isn't yours.

## 2. Merge, test, then commit

```bash
git merge --no-ff --no-commit <branch>
npm test > <log> 2>&1; echo "exit=$?"
```

- **Green, no conflicts:** `git commit --no-edit`.
- **Conflicts:** resolve them here, `git add` the files, run the verification gate on the result, then `git commit --no-edit`.
  If a conflict's right resolution isn't clear from the two sides, that is a question for the user, not a judgement call — `git merge --abort` and ask.
- **Red:** `git merge --abort`, then go back to the branch (`git switch <branch>`), fix it there, and start again from step 0.
  Never commit a red merge onto `main`, and never fix forward on `main`.

## 3. Release `main` — immediately

```bash
git switch --detach
```

Do this before reporting, before cleanup, before anything else.
Holding `main` blocks every other session's merge, and nothing about a finished merge needs `main` checked out.

## 4a. Work is finished — leave and clean up

1. Call `ExitWorktree` with action `"keep"`.
   The user's merge go-ahead is the ask that tool requires.
   Never `remove`: it counts commits from where the worktree was created, so it refuses merged work and would need `discard_changes`, which must never become routine.
2. The session is now in the main checkout, and no longer isolated.
   Re-anchor it at the new `main`:

   ```bash
   git switch --detach main
   ```

   New worktrees branch from this HEAD, so skipping it silently starts the next session from an old `main`.
3. Remove the worktree and the branch — both refuse if anything is unmerged or untracked, which is the point:

   ```bash
   git worktree remove .claude/worktrees/<name>
   git branch -d <branch>
   ```

   If either refuses, report it; never reach for `--force` or `-D`.

## 4b. Work continues in this session

Stay in the worktree and start the next branch from the new `main`, which uses `main` as a starting point without checking it out:

```bash
git switch -c <feature|fix|docs|chore>/<slug> main
git branch -d <old-branch>
```

Say in the report that the main checkout's anchor is now behind `main`, because it can only be re-anchored from outside the worktree: the next session to finish through 4a fixes it, or the user can run `git -C <main checkout> switch --detach main`.

## 5. Report

- The merge commit (`git log --oneline -1 main`) and how far `main` is ahead of `origin/main` (`git rev-list --count origin/main..main`).
- Which of 4a/4b ran, and anything that refused.
- **Never push.** Pushing `main` requires explicit user confirmation, every time.

## Recovery

- **`git switch main` names another worktree.** Check whether that session is alive:
  `git worktree list --porcelain` shows a `locked claude session … (pid N …)` line for worktrees Claude created;
  `ps -p N` says whether it runs.
  If it's alive, it's mid-merge — wait and tell the user.
  If it's dead, releasing `main` means `git -C <that worktree> switch --detach`, which worktree isolation won't let you run: hand the user the exact command to run as `! git -C <path> switch --detach`, after confirming its `git status` shows no merge in progress.
- **The main checkout's HEAD isn't `main`'s tip.** A previous session skipped 4a's re-anchor or took 4b.
  From the main checkout:
  `git switch --detach main`; from inside a worktree: ask the user.
- **A `locked` worktree whose session is gone.** A session that ended without `ExitWorktree` leaves one.
  After confirming the pid is dead and its branch is merged (`git branch --merged main`), `git worktree unlock <path>` then 4a's removal steps.
