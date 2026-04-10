# Progress Artifacts

Long-running work benefits from a small amount of explicit state that survives
between turns, sessions, and worktrees.

This repository uses the term `progress artifact` for a short, structured file
that explains the current state of active work.

## Purpose

A progress artifact should make it easy to answer:

- what is being worked on
- what is already done
- what is blocked or risky
- what the next concrete step is

It is not meant to replace transcripts, git history, or decision logs.

## Recommended Location

Use a project-local path inside the product namespace:

- `.claude-agent/progress.md`

If work is split across worktrees, each worktree can keep its own local
progress artifact.

## Recommended Structure

Keep it short and stable:

```md
# Progress

## Objective
One sentence describing the current task.

## Done
- Completed item

## Remaining
- Next item

## Risks
- Current risk or open question

## Next Step
One concrete next action.
```

## When To Update

Update the progress artifact when:

- a long task spans multiple sessions
- work pauses before completion
- the next step would otherwise need to be reconstructed from transcript history

## Relationship To Other Harness Files

- `docs/decisions/*` tracks non-trivial decisions
- `.claude-agent/progress.md` tracks active task state
- `README.md` and focused docs under `docs/` are the entry point for harness usage

These files serve different purposes and should stay small.
