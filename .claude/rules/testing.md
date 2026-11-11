---
paths:
  - "src/test/**"
  - "gui/tests/**"
  - "**/*.test.ts"
  - "scripts/e2e-*.mjs"
---

# Tests

- Keep an existing isolated test only if it catches a concrete bug E2E misses; delete ones that restate implementation or duplicate E2E.
- The only test preload is `scripts/bun-test-preload.ts` (sets global `React`); keep other setup inside each test.
- `scripts/e2e-startup-boundaries.mjs` 的 `effort-sent-state` case 曾在 CI 偶发失败一次（重跑通过，本地无法复现）；再次出现按真实线索处理。
