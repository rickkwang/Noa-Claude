---
paths:
  - "src/components/**"
  - "src/ink.ts"
  - "src/ink/**"
---

# Ink text

- `Text` from `src/ink.ts` is `ThemedText`: `backgroundColor` only resolves theme keys, so a raw hex background is silently dropped. Use `BaseText` for raw background colors.
