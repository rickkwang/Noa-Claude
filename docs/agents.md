# Agents

This product supports local subagents through `/agents`.

## Agent Sources

Agents can come from these scopes:

- built-in
- user settings
- project settings
- local settings
- plugin sources
- managed policy sources

The `/agents` UI resolves precedence for you. If two agents share the same
name, the higher-priority source wins and lower-priority definitions are shown
as shadowed.

## What `/agents` Shows

The productized `/agents` surface is intended to answer four questions quickly:

- where the agent came from
- what model and permissions it uses
- whether it runs in foreground or background
- whether it uses isolation, hooks, memory, or skills
- how many agents are currently running/pending in this session

## Operational Rules

- agent edits affect new runs, not already-running background agents
- built-in agents are visible but not editable
- project agents should live in project-local product paths, not legacy paths

## Product Paths

Preferred product paths:

- user-level: `~/.claude-agent/agents`
- project-level: `.claude-agent/agents`

Legacy `.claude/agents` may still be read for compatibility, but new product
usage should prefer `.claude-agent/agents`.
