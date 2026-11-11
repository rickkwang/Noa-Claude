---
paths:
  - "src/Task.ts"
  - "src/tasks/**"
  - "src/utils/task/**"
---

# Task status

- **Task status** (`TASK_STATUS_TRANSITIONS` in `src/Task.ts`): `completed`/`failed`/`killed` are final; both `updateTaskState` helpers drop illegal transitions. Decide the final outcome before the terminal write, and guard any direct `setAppState` task write with `isTerminalTaskStatus`. Resume re-registers via `registerTask`.
