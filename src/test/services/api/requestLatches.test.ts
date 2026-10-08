import { describe, expect, test } from 'bun:test'
import {
  applyRequestLatches,
  classifyRejectedField,
  healRejectedRequest,
  getRequestLatchSummary,
} from '../../../services/api/requestLatches.js'
import { APIError } from '@anthropic-ai/sdk'

// First-party-only fields never reach the scripted E2E endpoint (a custom base
// URL is treated as third-party), so these API error shapes are checked here.
describe('classifyRejectedField', () => {
  test.each([
    ['output_config.effort: Extra inputs are not permitted', 'output_config.effort'],
    ['This model does not support the effort parameter.', 'output_config.effort'],
    ['output_config.format: Extra inputs are not permitted', 'output_config.format'],
    ["thinking.adaptive.display: Input should be 'summarized' or 'omitted'", 'thinking.display'],
    ['thinking.enabled.block_binding: Extra inputs are not permitted', 'thinking.block_binding'],
    ['thinking.display: Extra inputs are not permitted', 'thinking.display'],
    ['adaptive thinking is not supported on this model', 'thinking.type:adaptive'],
    ['thinking.type: enabled is not supported for this model; use adaptive', 'thinking.type:enabled'],
    ['Unexpected value(s) `context-management-2025-06-27` for the `anthropic-beta` header', 'beta:context-management-2025-06-27'],
    ['system.0.cache_control: Extra inputs are not permitted', 'cache_control'],
    ['cache_control is not permitted in system messages', 'cache_control'],
    ['messages.0.content.0.tool_result.cache_control: Extra inputs are not permitted', 'cache_control'],
    ['system.0.cache_control.ttl: Extra inputs are not permitted', 'cache_control.ttl'],
    ["effort 'max' is not supported when thinking is disabled", undefined],
    ["effort 'xhigh' is not supported by this model", undefined],
    ['messages: Extra inputs are not permitted', undefined],
  ])('%s', (message, expected) => {
    expect(classifyRejectedField(message, ['context-management-2025-06-27'])).toBe(expected)
  })
})

describe('request latches', () => {
  const reject = (model: string, message: string) =>
    healRejectedRequest(new APIError(400, undefined, message, new Headers()), model)

  test('drops an unsupported TTL while retaining supported cache control', () => {
    const model = 'ttl-latch-test'
    const block: { type: string; text: string; cache_control: { type: string; ttl?: string } } =
      { type: 'text', text: 'cached', cache_control: { type: 'ephemeral', ttl: '1h' } }
    expect(reject(model, 'system.0.cache_control.ttl: Extra inputs are not permitted')).toBe('cache_control.ttl')
    const result = applyRequestLatches({ system: [block], tools: [block], messages: [{ role: 'user', content: [block] }] }, model)
    expect(result.system[0]!.cache_control).toEqual({ type: 'ephemeral' })
    expect(result.tools[0]!.cache_control).toEqual({ type: 'ephemeral' })
    expect(result.messages[0]!.content[0]!.cache_control).toEqual({ type: 'ephemeral' })
    expect(block.cache_control.ttl).toBe('1h')
    expect(reject(model, 'system.0.cache_control.ttl: Extra inputs are not permitted')).toBeUndefined()
    expect(getRequestLatchSummary()).toContain(`${model}: cache_control.ttl`)
  })

  test('rewrites and strips rejected fields, and refuses to heal the same field twice', () => {
    const model = 'latch-test-model'
    const params = {
      model,
      max_tokens: 32000,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
      system: [{ type: 'text', text: 's', cache_control: { type: 'ephemeral' } }],
      messages: [],
    }
    expect(reject(model, 'adaptive thinking is not supported on this model')).toBe('thinking.type:adaptive')
    expect(reject(model, 'output_config.effort: Extra inputs are not permitted')).toBe('output_config.effort')
    expect(reject(model, 'system.0.cache_control: Extra inputs are not permitted')).toBe('cache_control')
    expect(reject(model, 'output_config.effort: Extra inputs are not permitted')).toBeUndefined()

    const sent = applyRequestLatches(params, model) as Record<string, any>
    expect(sent.thinking.type).toBe('enabled')
    expect(sent.thinking.budget_tokens).toBeLessThan(32000)
    expect(sent.output_config).toBeUndefined()
    expect(sent.system[0].cache_control).toBeUndefined()
    expect(applyRequestLatches(params, 'other-model')).toEqual(params)
  })
})
