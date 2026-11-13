---
paths:
  - "src/test/**"
  - "gui/tests/**"
  - "**/*.test.ts"
  - "scripts/e2e-*"
---

# Tests

- Keep an existing isolated test only if it catches a concrete bug E2E misses; delete ones that restate implementation or duplicate E2E.
- The only test preload is `scripts/bun-test-preload.ts` (sets global `React`); keep other setup inside each test.
