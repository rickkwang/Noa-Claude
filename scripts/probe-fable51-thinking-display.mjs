#!/usr/bin/env bun
/**
 * One-off probe: does `redact-thinking-2026-02-12` suppress Fable 5.1's
 * between-tool progress updates?
 *
 * Why this exists
 * ---------------
 * On Opus 5, text the model wrote between tool calls came back as `text`
 * blocks. On Fable 5.1 it comes back as progress-update `thinking` blocks
 * instead. claude.ts already sends `display: 'summarized'`, which per the API
 * docs returns progress-update text alongside the reasoning summaries — so the
 * documented path is covered.
 *
 * But in interactive sessions Noa *also* sends `redact-thinking-2026-02-12`
 * (betas.ts) to skip the API-side summarizer, and the interaction between that
 * beta and progress updates is not documented anywhere. If redact-thinking
 * empties the progress blocks too, a long tool-calling turn renders silent and
 * we should send `display: 'updates'` for Fable-tier instead.
 *
 * This probe answers that empirically. It is NOT part of any test suite: it
 * costs real money and needs a live credential.
 *
 *   ANTHROPIC_API_KEY=sk-... bun scripts/probe-fable51-thinking-display.mjs
 *
 * Roughly 3 requests at Fable pricing ($10/$50 per MTok) on a tiny prompt —
 * cents, not dollars.
 */
import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-fable-5-1'
const REDACT_THINKING_BETA = 'redact-thinking-2026-02-12'
const UPDATES_BETA = 'thinking-display-updates-2026-08-18'

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error(
    'Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) before running this probe.',
  )
  process.exit(1)
}

const client = new Anthropic()

/**
 * A prompt that forces several sequential tool calls, which is the only place
 * progress updates are emitted. Sequential matters: the model has to see each
 * result before deciding the next call, which is what produces the "what I
 * just found / what I'll do next" narration.
 */
const TOOLS = [
  {
    name: 'read_counter',
    description:
      'Read the current value of a named counter. Call this before incrementing so you know the starting value.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'increment_counter',
    description: 'Increment a named counter by an amount and return the new value.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        by: { type: 'number' },
      },
      required: ['name', 'by'],
      additionalProperties: false,
    },
  },
]

const PROMPT =
  'Counters "alpha", "beta" and "gamma" exist. One at a time, read each one, ' +
  'then increment it by its own current value. Read before each increment — ' +
  'do not batch the reads. Report the three final values when done.'

const counters = { alpha: 3, beta: 5, gamma: 7 }

function runTool(name, input) {
  if (name === 'read_counter') {
    return String(counters[input.name] ?? 0)
  }
  counters[input.name] = (counters[input.name] ?? 0) + (input.by ?? 0)
  return String(counters[input.name])
}

/**
 * Drive the tool loop to completion, counting thinking blocks and how many of
 * them carried visible text. A progress update is any thinking block with
 * non-empty text.
 */
async function probe(label, { display, extraBetas }) {
  const betas = ['thinking-binding-controls-2026-08-01', ...extraBetas]
  const messages = [{ role: 'user', content: PROMPT }]

  let thinkingBlocks = 0
  let nonEmptyThinkingBlocks = 0
  let textBlocks = 0
  let turns = 0
  const samples = []

  for (let i = 0; i < 12; i++) {
    turns++
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4096,
      betas,
      thinking: {
        type: 'adaptive',
        display,
        block_binding: { prefix_mismatch_behavior: 'drop_block' },
      },
      tools: TOOLS,
      messages,
    })

    if (response.stop_reason === 'refusal') {
      return { label, error: `refused: ${response.stop_details?.category}` }
    }

    for (const block of response.content) {
      if (block.type === 'thinking') {
        thinkingBlocks++
        const text = (block.thinking ?? '').trim()
        if (text.length > 0) {
          nonEmptyThinkingBlocks++
          if (samples.length < 3) samples.push(text.slice(0, 160))
        }
      } else if (block.type === 'text') {
        textBlocks++
      }
    }

    messages.push({ role: 'assistant', content: response.content })

    const toolUses = response.content.filter(b => b.type === 'tool_use')
    if (toolUses.length === 0) break

    messages.push({
      role: 'user',
      content: toolUses.map(tu => ({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: runTool(tu.name, tu.input),
      })),
    })
  }

  return {
    label,
    turns,
    thinkingBlocks,
    nonEmptyThinkingBlocks,
    textBlocks,
    samples,
  }
}

const scenarios = [
  // What claude.ts sends today in SDK / print mode (no redact-thinking).
  {
    label: "summarized, no redact-thinking  (today's non-interactive path)",
    display: 'summarized',
    extraBetas: [],
  },
  // What claude.ts sends today in an interactive session. THE QUESTION.
  {
    label: 'summarized + redact-thinking     (today\'s interactive path)',
    display: 'summarized',
    extraBetas: [REDACT_THINKING_BETA],
  },
  // The candidate fix, if the row above comes back empty.
  {
    label: 'updates + redact-thinking        (candidate fix)',
    display: 'updates',
    extraBetas: [REDACT_THINKING_BETA, UPDATES_BETA],
  },
]

const results = []
for (const scenario of scenarios) {
  process.stderr.write(`running: ${scenario.label}\n`)
  // Reset counters so each scenario drives the same number of tool calls.
  Object.assign(counters, { alpha: 3, beta: 5, gamma: 7 })
  try {
    results.push(await probe(scenario.label, scenario))
  } catch (err) {
    results.push({ label: scenario.label, error: String(err?.message ?? err) })
  }
}

console.log('\n=== Fable 5.1 thinking display probe ===\n')
for (const r of results) {
  if (r.error) {
    console.log(`${r.label}\n  ERROR: ${r.error}\n`)
    continue
  }
  console.log(r.label)
  console.log(
    `  turns=${r.turns}  thinking blocks=${r.thinkingBlocks}  ` +
      `with visible text=${r.nonEmptyThinkingBlocks}  text blocks=${r.textBlocks}`,
  )
  for (const s of r.samples) {
    console.log(`    · ${s.replace(/\s+/g, ' ')}`)
  }
  console.log()
}

console.log('How to read this:')
console.log(
  '  If row 2 has visible text > 0, redact-thinking does NOT suppress progress',
)
console.log('  updates and no code change is needed — close the item.')
console.log(
  '  If row 2 is 0 but row 3 is > 0, redact-thinking swallows them and the fix',
)
console.log("  is to send display:'updates' for Fable-tier when redact is on.")
console.log(
  '  If row 3 is also 0, the two betas do not compose; the choice is then to',
)
console.log('  drop redact-thinking on Fable-tier or accept the silence.')
