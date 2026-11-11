---
paths:
  - "src/services/api/**"
  - "src/services/compact/**"
  - "src/query.ts"
  - "src/QueryEngine.ts"
---

# Preserved thinking

- **Preserved thinking**: on models where `modelEnforcesThinkingPrefixBinding()` is true, never rewrite system, tools, or messages already sent — a client-side edit (e.g. clearing old tool results) invalidates every later thinking block. Partial compaction's kept tail is the one accepted exception, absorbed by `drop_block`. `e2e-agent-loop.mjs --case preserved-thinking` asserts sent messages stay unchanged.
