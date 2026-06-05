// @ts-nocheck
import { feature } from 'bun:bundle'
import type { PartialCompactDirection } from '../../types/message.js'

// Dead code elimination: conditional import for proactive mode
/* eslint-disable @typescript-eslint/no-require-imports */
const proactiveModule =
  feature('PROACTIVE') || feature('KAIROS')
    ? (require('../../proactive/index.js') as typeof import('../../proactive/index.js'))
    : null
/* eslint-enable @typescript-eslint/no-require-imports */

// Aggressive no-tools preamble. The cache-sharing fork path inherits the
// parent's full tool set (required for cache-key match), and on Sonnet 4.6+
// adaptive-thinking models the model sometimes attempts a tool call despite
// the weaker trailer instruction. With maxTurns: 1, a denied tool call means
// no text output → falls through to the streaming fallback (2.79% on 4.6 vs
// 0.01% on 4.5). Putting this FIRST and making it explicit about rejection
// consequences prevents the wasted turn.
const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.

`

// The <analysis> block is a drafting scratchpad that formatCompactSummary()
// strips before the summary reaches context. Parameterized by scope so BASE
// and PARTIAL share the bullet list without duplicating it.
function getAnalysisInstruction(scope: 'full' | 'recent'): string {
  const target =
    scope === 'full'
      ? 'each message and section of the conversation'
      : 'the recent messages chronologically'
  const fidelityScope =
    scope === 'full'
      ? 'what a future turn would need to continue safely without reproducing the entire transcript'
      : 'what a future turn would need from the recent messages without reproducing the whole transcript'
  return `Before providing your final summary, wrap your analysis in <analysis> tags. In your analysis:

1. Analyze ${target}. For each section identify:
   - The user's explicit requests and intents
   - Your approach and key decisions
   - Technical concepts, code patterns, file names, function signatures, and file edits
   - Exact code or text only when necessary to preserve meaning
   - Errors encountered and how they were fixed
   - User feedback that changed direction, constraints, or standards
2. Double-check for technical accuracy and completeness, ensuring the summary preserves ${fidelityScope}.`
}

// Shared output contract: dedupes the identical fidelity line that all three
// templates carried, adds the density budget, and makes the <summary> envelope
// explicit in the body (preamble/trailer already mention it, but weaker
// adaptive-thinking models comply more reliably when the body restates it).
const OUTPUT_FIDELITY_INSTRUCTION = `Do not reproduce all user messages, long file contents, or full code snippets unless the exact text is necessary to preserve meaning. Keep the summary dense — a small fraction of the original conversation, not a transcript.

Wrap your entire summary in <summary> tags.`

// Shared sections 1-6 are identical across all three templates; only the
// final sections (7-8) differ by compact direction.
const SHARED_SECTIONS = `1. Primary Request and Intent: The user's explicit requests and intents in detail.
2. Key Technical Concepts: Technologies, frameworks, and patterns discussed.
3. Files and Code: Files examined, modified, or created. Summarize the relevant code and why it matters; include exact snippets only when the text is load-bearing.
4. Errors, Fixes, and Problem Solving: Errors encountered, how they were fixed, and ongoing troubleshooting.
5. User Feedback and Direction Changes: Constraints and corrections that materially changed the work. Quote exact wording only when needed to avoid drift.
6. Pending Tasks: Tasks explicitly asked to work on that remain incomplete.`

const BASE_COMPACT_PROMPT = `Your task is to create a detailed continuation summary of the conversation so far. Preserve the technical and task context needed to continue development work safely; do not turn the summary into a transcript.

${getAnalysisInstruction('full')}

Your summary should include:

${SHARED_SECTIONS}
7. Current Work: What was being worked on immediately before this summary, with attention to the most recent messages.
8. Optional Next Step: The implied next step, only if clearly implied by recent requests and work in progress.

${OUTPUT_FIDELITY_INSTRUCTION}

Please provide your summary based on the conversation so far, optimizing for continuation quality.

If the included context contains additional summarization instructions (e.g. "Compact Instructions" or "Summary instructions"), follow them when creating the summary.
`

const PARTIAL_COMPACT_PROMPT = `Your task is to create a continuation summary of the RECENT portion of the conversation — the messages after earlier retained context. The earlier messages are kept intact and do NOT need summarizing.

${getAnalysisInstruction('recent')}

Your summary should cover the RECENT messages only. Include:

${SHARED_SECTIONS}
7. Current Work: What was being worked on immediately before this summary.
8. Optional Next Step: The implied next step from the recent work, only if clearly implied.

${OUTPUT_FIDELITY_INSTRUCTION}

Please provide your summary based on the RECENT messages only, optimizing for continuation quality.
`

// 'up_to': model sees only the summarized prefix (cache hit). Summary will
// precede kept recent messages, hence "Context for Continuing Work" section.
const PARTIAL_COMPACT_UP_TO_PROMPT = `Your task is to create a continuation summary of this conversation. This summary will precede newer messages you do not see here. Preserve enough detail that someone reading your summary and then those messages can continue the work without the earlier transcript.

${getAnalysisInstruction('full')}

Your summary should include:

${SHARED_SECTIONS}
7. Work Completed: What was accomplished by the end of this portion.
8. Context for Continuing Work: Decisions, state, or context needed to understand subsequent messages.

${OUTPUT_FIDELITY_INSTRUCTION}

Please provide your summary optimizing for continuation quality.
`

const NO_TOOLS_TRAILER =
  '\n\nREMINDER: Do NOT call any tools. Respond with plain text only — ' +
  'an <analysis> block followed by a <summary> block. ' +
  'Tool calls will be rejected and you will fail the task.'

export function getPartialCompactPrompt(
  customInstructions?: string,
  direction: PartialCompactDirection = 'from',
  targetMessageCount?: number,
): string {
  const template =
    direction === 'up_to'
      ? PARTIAL_COMPACT_UP_TO_PROMPT
      : PARTIAL_COMPACT_PROMPT
  let prompt = NO_TOOLS_PREAMBLE + template
  const boundaryInstruction =
    direction === 'from' &&
    typeof targetMessageCount === 'number' &&
    targetMessageCount > 0
      ? `\n\nRecent-message boundary: summarize only the recent tail selected for partial compaction: at most the final ${targetMessageCount} messages visible in this compact request. Treat all earlier messages as retained context only; do not summarize or restate them except where a brief reference is necessary to explain the recent messages.`
      : ''

  if (customInstructions && customInstructions.trim() !== '') {
    prompt += `\n\nAdditional Instructions:\n${customInstructions}`
  }

  prompt += boundaryInstruction
  prompt += NO_TOOLS_TRAILER

  return prompt
}

export function getCompactPrompt(customInstructions?: string): string {
  let prompt = NO_TOOLS_PREAMBLE + BASE_COMPACT_PROMPT

  if (customInstructions && customInstructions.trim() !== '') {
    prompt += `\n\nAdditional Instructions:\n${customInstructions}`
  }

  prompt += NO_TOOLS_TRAILER

  return prompt
}

/**
 * Formats the compact summary by stripping the <analysis> drafting scratchpad
 * and replacing <summary> XML tags with readable section headers.
 * @param summary The raw summary string potentially containing <analysis> and <summary> XML tags
 * @returns The formatted summary with analysis stripped and summary tags replaced by headers
 */
export function formatCompactSummary(summary: string): string {
  let formattedSummary = summary

  const summaryMatch = formattedSummary.match(
    /<summary\b[^>]*>([\s\S]*?)<\/summary>/i,
  )
  if (summaryMatch) {
    const content = summaryMatch[1] || ''
    return `Summary:\n${content.trim()}`.trim()
  }

  // Strip analysis section — it's a drafting scratchpad that improves summary
  // quality but has no informational value once the summary is written.
  formattedSummary = formattedSummary.replace(
    /<analysis\b[^>]*>[\s\S]*?<\/analysis>/gi,
    '',
  )

  // Clean up extra whitespace between sections
  formattedSummary = formattedSummary.replace(/\n\n+/g, '\n\n')

  return formattedSummary.trim()
}

export const COMPACT_SUMMARY_LEGACY_INTRO =
  'This session continues from an earlier conversation. The summary below covers the earlier portion of the conversation.'
export const COMPACT_SUMMARY_TRANSCRIPT_HINT_PREFIX =
  'If you need specific details from before compaction'
export const COMPACT_SUMMARY_CONTINUATION_PREFIX =
  'Continue the conversation from where it left off'
export const COMPACT_SUMMARY_PROACTIVE_MODE_PREFIX =
  'You are running in autonomous/proactive mode.'

export function getCompactUserSummaryMessage(
  summary: string,
  suppressFollowUpQuestions?: boolean,
  transcriptPath?: string,
): string {
  const formattedSummary = formatCompactSummary(summary)

  let baseSummary = `${COMPACT_SUMMARY_LEGACY_INTRO}

${formattedSummary}`

  if (transcriptPath) {
    baseSummary += `\n\n${COMPACT_SUMMARY_TRANSCRIPT_HINT_PREFIX} (like exact code snippets, error messages, or content you generated), read the full transcript at: ${transcriptPath}`
  }

  if (suppressFollowUpQuestions) {
    let continuation = `${baseSummary}
${COMPACT_SUMMARY_CONTINUATION_PREFIX} without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.`

    if (
      (feature('PROACTIVE') || feature('KAIROS')) &&
      proactiveModule?.isProactiveActive()
    ) {
      continuation += `

${COMPACT_SUMMARY_PROACTIVE_MODE_PREFIX} This is NOT a first wake-up — you were already working autonomously before compaction. Continue your work loop: pick up where you left off based on the summary above. Do not greet the user or ask what to work on.`
    }

    return continuation
  }

  return baseSummary
}
