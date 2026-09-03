import { describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import {
  classifyAPIError,
  getAssistantMessageFromError,
  isDataRetentionRequiredError,
} from '../../../services/api/errors.js'

// The wording the API returns for a Covered Model (Fable / Mythos) requested
// from an org or workspace without 30-day retention.
const SERVER_MESSAGE =
  'In order to access this model, your organization or workspace must have data retention enabled.'

const make400 = (message: string) =>
  new APIError(400, { error: { message } }, message, new Headers())

function render(error: APIError, model: string): { kind?: string; text: string } {
  const result = getAssistantMessageFromError(error, model) as {
    error?: string
    message?: { content?: unknown }
  }
  const content = result.message?.content
  const text = Array.isArray(content)
    ? (content as Array<{ type: string; text?: string }>)
        .filter(block => block.type === 'text')
        .map(block => block.text ?? '')
        .join('')
    : ''
  return { kind: result.error, text }
}

describe('data retention requirement (Covered Models)', () => {
  test('recognises the server wording', () => {
    expect(isDataRetentionRequiredError(SERVER_MESSAGE)).toBe(true)
  })

  test('does not fire on unrelated 400s', () => {
    expect(isDataRetentionRequiredError('invalid model name')).toBe(false)
    expect(
      isDataRetentionRequiredError(
        '`tool_use` ids were found without `tool_result` blocks immediately after',
      ),
    ).toBe(false)
    // A prose mention of retention without the requirement clause.
    expect(isDataRetentionRequiredError('data retention policy updated')).toBe(
      false,
    )
  })

  test('names the model and points at the actual knob', () => {
    const { kind, text } = render(make400(SERVER_MESSAGE), 'claude-fable-5-1')
    expect(kind).toBe('invalid_request')
    expect(text).toContain('claude-fable-5-1')
    expect(text).toContain('30-day data retention')
    // Must not fall through to the generic "report this to us" 400 message.
    expect(text).not.toContain('/share')
  })

  test('classifies into its own bucket', () => {
    expect(classifyAPIError(make400(SERVER_MESSAGE))).toBe(
      'data_retention_required',
    )
  })
})
