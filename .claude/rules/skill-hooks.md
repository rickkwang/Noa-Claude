---
paths:
  - "src/utils/hooks/**"
  - "src/tools/AgentTool/**"
  - "src/skills/**"
---

# Skill hooks

- **Skill hooks** (`src/utils/hooks/registerSkillHooks.ts`): cleanup and success callbacks use registration identity, not command equality. Budgets are cumulative per source and session (1,024 hooks / 16,384 matcher chars), counting hooks already consumed by `once`. When plugin-only hook policy excludes a skill's hooks, also exclude its `allowed-tools`, including inline shell expansion and fork execution.
- **Agent skill hooks** register and clean up through `setAppStateForTasks ?? setAppState` (a background agent's `setAppState` may be a no-op). Agent exit always clears session hooks, including ones skills registered during the run.
