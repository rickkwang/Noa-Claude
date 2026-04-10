# Worktrees

Worktrees are the preferred isolation mechanism for parallel repository tasks.

## Product Behavior

The product should treat worktree context as first-class state:

- current worktree name
- worktree branch
- worktree path
- original cwd

These should be visible in `/status` and respected by resume flows.

## Expected Workflow

When using a worktree:

- start the session inside the worktree
- let the session metadata bind to that worktree context
- use resume from the same worktree when possible
- use cross-worktree resume only when intentionally moving context

## Goal

The harness should make parallel development easier, not more ambiguous.
That means same-repo worktrees should feel like separate but recoverable task
containers.
