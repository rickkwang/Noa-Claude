# Agent Personality Names Design

## Summary
Replace the generic `"Agent"` label for worker/general-purpose subagents with a randomly assigned historical figure name, displayed as `Name (description)` in the TUI.

## Motivation
Currently, worker agents display as `Agent (description)` which is visually monotonous when multiple agents run concurrently. Assigning recognizable historical figure names improves visual distinction and adds personality.

## Design

### Name Pool
32 well-known historical figures across science, philosophy, and arts:

Newton, Einstein, Tesla, Curie, Hawking, Bohr, Feynman, Maxwell, Dirac, Taylor, Turing, Euler, Gauss, Archimedes, Babbage, Lovelace, Socrates, Plato, Aristotle, Confucius, Mencius, Descartes, Kant, Nietzsche, Darwin, Mozart, Beethoven, Shakespeare, DaVinci, Galileo, Copernicus, Kepler

### Display Format
`Name (description)` — e.g. `Newton (api-audit)`

- Name replaces the generic `"Agent"` label
- Description remains the task description from the tool input
- Only applies to `subagent_type === 'worker'` or general-purpose agents
- Custom subagents (Explore, Plan, etc.) keep their existing type-based display

### Implementation

**Approach**: Runtime global Map plus persisted task metadata.

**Files touched**:
1. `src/tools/AgentTool/constants.ts` — name pool, assignment, restore, and deterministic color helpers
2. `src/tools/AgentTool/AgentTool.tsx` — assign names for unnamed generic agents and include them in tool output/metadata
3. `src/tools/AgentTool/resumeAgent.ts` and `src/tools/AgentTool/runAgent.ts` — restore and persist names across resume
4. `src/tasks/LocalAgentTask/LocalAgentTask.tsx` and `src/utils/sessionStorage.ts` — carry names in task state and session metadata
5. UI components — render personality names in grouped progress, tool headers, task panel, and viewed-agent banner

**Key behaviors**:
- Name assigned once per unnamed generic agentId at creation time
- Explicit `name` values remain the display and SendMessage routing name; personality names are display-only fallbacks
- Names are persisted in agent metadata so resume/restart keeps the same label
- Concurrent agents avoid collision by excluding already-used names when possible
- If all base names are taken, a numeric suffix is added to avoid active duplicate labels

### Scope Limits
- No user-configurable toggle (can be added later if requested)
- No per-agent-type theming (personality names use deterministic foreground colors)
