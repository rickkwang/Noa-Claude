// @ts-nocheck
// Extracted from dream.ts so auto-dream ships independently of KAIROS
// feature flags (dream.ts is behind a feature()-gated require).

import {
  DIR_EXISTS_GUIDANCE,
  ENTRYPOINT_NAME,
  MAX_ENTRYPOINT_LINES,
} from '../../memdir/memdir.js'

// Team memory is shared with every collaborator, so pruning it stays
// conservative: an unfamiliar team note may still be load-bearing for someone.
const TEAM_MEMORY_SECTION = `## Team memory (\`team/\` subdirectory)

The \`team/\` subdirectory holds memories shared across everyone working in this repo. Other teammates' sessions write here too — treat it differently from your personal files:

- **Phase 1:** \`ls team/\` and skim it alongside your personal files.
- **Phase 3:** Merge near-duplicates within \`team/\` the same way you would personal memories. If a personal memory restates a team memory, delete the personal one.
- **Phase 4 — be conservative pruning \`team/\`:**
  - DO delete or fix a team memory that is clearly contradicted by the current code, or that a newer team memory marks as superseded.
  - DO NOT delete a team memory just because you don't recognize it or it isn't relevant to your recent sessions.
  - When unsure, leave it.

Do not promote personal memories into \`team/\` during a dream — that is a deliberate choice the user makes via \`/remember\`.

`

// Shared by auto-dream (forked, constrained tools) and the manual /dream skill
// (main loop, normal tools), so both read and write the same memory index.
export function buildConsolidationPrompt(
  memoryRoot: string,
  transcriptDir: string,
  extra: string,
  teamMemoryEnabled = false,
): string {
  return `# Dream: Memory Consolidation

You are performing a dream — a reflective pass over your memory files. Synthesize what you've learned recently into durable, well-organized memories so that future sessions can orient quickly.

Memory directory: \`${memoryRoot}\`
${DIR_EXISTS_GUIDANCE}

Session transcripts: \`${transcriptDir}\` (large JSONL files — grep narrowly, don't read whole files)

---

## Phase 1 — Orient

- \`ls\` the memory directory to see what already exists
- Read \`${ENTRYPOINT_NAME}\` to understand the current index
- Skim existing topic files so you improve them rather than creating duplicates
- If \`logs/\` or \`sessions/\` subdirectories exist (assistant-mode layout), review recent entries there

## Phase 2 — Gather recent signal

Look for new information worth persisting. Sources in rough priority order:

1. **Daily logs** (\`logs/YYYY/MM/YYYY-MM-DD.md\`) if present — these are the append-only stream
2. **Existing memories that drifted** — facts that contradict something you see in the codebase now
3. **Transcript search** — if you need specific context (e.g., "what was the error message from yesterday's build failure?"), grep the JSONL transcripts for narrow terms:
   \`grep -rn "<narrow term>" ${transcriptDir}/ --include="*.jsonl" | tail -50\`

Don't exhaustively read transcripts. Look only for things you already suspect matter.

## Phase 3 — Consolidate

For each thing worth remembering, write or update a memory file at the top level of the memory directory. Use the memory file format and type conventions from your system prompt's auto-memory section — it's the source of truth for what to save, how to structure it, and what NOT to save.

Focus on:
- Merging new signal into existing topic files rather than creating near-duplicates
- Converting relative dates ("yesterday", "last week") to absolute dates so they remain interpretable after time passes
- Deleting contradicted facts — if today's investigation disproves an old memory, fix it at the source

### Reconcile memories against CLAUDE.md

If CLAUDE.md instructions are loaded in your system prompt, check each \`feedback\` or \`project\` memory against them:
- **Memory is stale** — CLAUDE.md and the memory describe different procedures for the same task. CLAUDE.md is the maintained, checked-in source: delete the memory, or rewrite it to agree if it carries context worth keeping (the *why* may still hold; the *how* is wrong).
- **CLAUDE.md may be stale** — the memory is clearly newer than CLAUDE.md and explicitly corrects it. Do NOT edit CLAUDE.md during a dream. Annotate the memory with "contradicts CLAUDE.md — verify which is current" and list it in your summary so the user can update CLAUDE.md.
- **Not a conflict** — the memory adds detail CLAUDE.md doesn't cover, or narrows a CLAUDE.md rule with a stated reason. Leave it.

A \`feedback\` memory's "Why: the user corrected me" framing is not evidence it is newer than CLAUDE.md — CLAUDE.md may have been updated since.

## Phase 4 — Prune and index

Update \`${ENTRYPOINT_NAME}\` so it stays under ${MAX_ENTRYPOINT_LINES} lines AND under ~25KB. It's an **index**, not a dump — each entry should be one line under ~150 characters: \`- [Title](file.md) — one-line hook\`. Never write memory content directly into it.

- Remove pointers to memories that are now stale, wrong, or superseded
- Demote verbose entries: if an index line is over ~200 chars, it's carrying content that belongs in the topic file — shorten the line, move the detail
- Add pointers to newly important memories
- Resolve contradictions — if two files disagree, fix the wrong one

${teamMemoryEnabled ? TEAM_MEMORY_SECTION : ''}---

Return a brief summary of what you consolidated, updated, or pruned. If nothing changed (memories are already tight), say so.${extra ? `\n\n## Additional context\n\n${extra}` : ''}`
}
