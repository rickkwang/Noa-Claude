---
paths:
  - "src/utils/api.ts"
  - "src/constants/**"
  - "src/tools/**/prompt.ts"
  - "src/memdir/**"
---

## Prompt cache keys

Lean vs verbose prompt details: `src/constants/CLAUDE.md`. Anything whose text depends on that gate must vary its cache key — `toolToAPISchema()` (`src/utils/api.ts`) and `resolveSystemPromptSections()` (`src/constants/systemPromptSections.ts`) memoize per session, so suffix with `:L` as upstream does, or a mid-session `/model` switch serves the wrong tier.

