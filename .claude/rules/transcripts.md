---
paths:
  - "src/utils/sessionStorage.ts"
---

# Transcripts

- **Transcripts** (`src/utils/sessionStorage.ts`): tombstones may truncate the last entry directly; removing earlier entries must preserve the original file on write failure. Finish pending appends before replacing a transcript. Tail entries stay removable above the full-rewrite size limit using bounded buffers.
