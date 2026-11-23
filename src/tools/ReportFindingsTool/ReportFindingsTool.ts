import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

export const REPORT_FINDINGS_TOOL_NAME = 'ReportFindings'

const DESCRIPTION =
  "Report code-review findings as a typed list so the host UI can render them. Use this only when the active code-review instructions tell you to report findings with this tool; otherwise follow whatever output format those instructions specify. When reporting a review's results, call it once with the verified findings ranked most-severe first (empty array if nothing survived verification) and do not also print the findings as text. When re-reporting after applying fixes (only if the apply instructions ask for it), set `outcome` on each finding to what actually happened."

const ReviewLevelSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max'])
const FindingSeveritySchema = z.enum(['important', 'pre_existing', 'nit'])
const FindingVerdictSchema = z.enum(['CONFIRMED', 'PLAUSIBLE'])
const FindingOutcomeSchema = z.enum(['fixed', 'skipped', 'no_change_needed'])

const FindingItemSchema = lazySchema(() =>
  z.strictObject({
    file: z.string().describe('Repo-relative path of the file the finding is in'),
    line: z
      .number()
      .int()
      .optional()
      .describe('1-indexed line the finding anchors to'),
    summary: z.string().describe('Statement of the defect'),
    short_summary: z
      .string()
      .max(60)
      .optional()
      .describe(
        'Compressed label for compact UI (≤60 chars): the claim alone, no rationale or consequence clause',
      ),
    failure_scenario: z
      .string()
      .describe('Concrete inputs/state → wrong output/crash'),
    category: z
      .string()
      .max(40)
      .optional()
      .describe(
        'Short kebab-case slug of the finding type, e.g. "correctness", "simplification", "efficiency", "test-coverage"',
      ),
    severity: FindingSeveritySchema.optional().describe(
      'Set when the review instructions ask for it. important: a bug the change adds or makes worse; pre_existing: a bug that was there before the change; nit: a minor issue',
    ),
    verdict: FindingVerdictSchema.optional().describe(
      'Set when a verify pass ran; absent on inline-only reviews',
    ),
    outcome: FindingOutcomeSchema.optional().describe(
      'Set ONLY when re-reporting after applying fixes: what happened to this finding',
    ),
  }),
)

const inputSchema = lazySchema(() =>
  z.strictObject({
    level: ReviewLevelSchema.optional().describe(
      'Effort level the review ran at',
    ),
    findings: z
      .array(FindingItemSchema())
      .max(32)
      .describe('Verified findings, most-severe first; empty if none survived'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    level: ReviewLevelSchema.optional(),
    findings: z.array(FindingItemSchema()),
    count: z.number().int().nonnegative(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type FindingItem = z.infer<ReturnType<typeof FindingItemSchema>>
export type Output = z.infer<OutputSchema>

export const ReportFindingsTool = buildTool({
  name: REPORT_FINDINGS_TOOL_NAME,
  searchHint: 'report typed code-review findings for structured UI rendering',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return DESCRIPTION
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'ReportFindings'
  },
  isEnabled() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  renderToolUseMessage() {
    return null
  },
  async call(input) {
    return {
      data: {
        ...(input.level ? { level: input.level } : {}),
        findings: input.findings,
        count: input.findings.length,
      },
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (output.count === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: output.level
          ? `Reported 0 findings (level: ${output.level}).`
          : 'Reported 0 findings.',
      }
    }
    const counts = new Map<string, number>()
    for (const f of output.findings) {
      const key = f.severity ?? 'unclassified'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const breakdown = [...counts.entries()]
      .map(([k, v]) => `${v} ${k}`)
      .join(', ')
    const header = output.level
      ? `Reported ${output.count} finding(s) at level ${output.level} (${breakdown}):`
      : `Reported ${output.count} finding(s) (${breakdown}):`
    const lines = output.findings.map((f, i) => {
      const loc = f.line !== undefined ? `${f.file}:${f.line}` : f.file
      const tags = [f.severity, f.verdict, f.outcome].filter(Boolean).join('/')
      const tagPart = tags ? ` [${tags}]` : ''
      return `${i + 1}. ${loc}${tagPart} — ${f.short_summary ?? f.summary}`
    })
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: [header, ...lines].join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
