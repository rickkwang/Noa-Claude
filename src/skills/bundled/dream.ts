// @ts-nocheck
import { isAutoMemoryEnabled } from '../../memdir/paths.js'
import { buildConsolidationPrompt } from '../../services/autoDream/consolidationPrompt.js'
import { registerBundledSkill } from '../bundledSkills.js'

export function registerDreamSkill(): void {
  const SKILL_PROMPT = `# Dream: Memory Consolidation

You are performing a dream — a reflective pass over your memory files. Synthesize what you've learned recently into durable, well-organized memories so that future sessions can orient quickly.

---

## Phase 1 — Orient

- \`ls\` the memory directory to see what already exists
- Read \`CLAUDE.md\` to understand the current index
- Skim existing topic files so you improve them rather than creating duplicates
- If \`logs/\` or \`sessions/\` subdirectories exist, review recent entries there

## Phase 2 — Gather recent signal

Look for new information worth persisting. Sources in rough priority order:

1. **Daily logs** (\`logs/YYYY/MM/YYYY-MM-DD.md\`) if present — these are the append-only stream
2. **Existing memories that drifted** — facts that contradict something you see in the codebase now
3. **Transcript search** — if you need specific context, grep narrowly:
   \`grep -rn "<narrow term>" . --include="*.jsonl" | tail -50\`

Don't exhaustively read transcripts. Look only for things you already suspect matter.

## Phase 3 — Consolidate

For each thing worth remembering, write or update a memory file at the top level of the memory directory.

Focus on:
- Merging new signal into existing topic files rather than creating near-duplicates
- Converting relative dates ("yesterday", "last week") to absolute dates so they remain interpretable after time passes
- Deleting contradicted facts — if today's investigation disproves an old memory, fix it at the source

## Phase 4 — Prune and index

Update \`CLAUDE.md\` so it stays under ~25KB. It's an **index**, not a dump — each entry should be one line under ~150 characters.

- Remove pointers to memories that are now stale, wrong, or superseded
- Add pointers to newly important memories
- Resolve contradictions — if two files disagree, fix the wrong one

---

Return a brief summary of what you consolidated, updated, or pruned.`

  registerBundledSkill({
    name: 'dream',
    description:
      'Run memory consolidation — a reflective pass over your memory files to synthesize recent learning into durable, well-organized memories.',
    whenToUse:
      'Use when the user wants to trigger an immediate memory consolidation. Also useful after a significant session or at the start of a new project to orient.',
    userInvocable: true,
    isEnabled: () => isAutoMemoryEnabled(),
    context: 'fork',
    async getPromptForCommand(args) {
      // Mtime stamping happens in executeForkedSlashCommand after the agent
      // completes successfully, not here. Stamping at prompt-build time
      // mis-locks auto-dream for 24h when the user ESCs immediately.
      let prompt = SKILL_PROMPT
      if (args) {
        prompt += `\n\n## Additional context\n\n${args}`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
