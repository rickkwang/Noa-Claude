import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { SandboxManager } from '../../../utils/sandbox/sandbox-adapter.js'
import type { PermissionResult } from '../../../types/permissions.js'
import { requireSandboxOverrideApproval } from '../../../tools/BashTool/shouldUseSandbox.js'

// The real sandbox is unavailable on most hosts, so the two answers the
// decision depends on are stubbed on the live SandboxManager object.
let sandboxOn = true
let unsandboxedAllowed = true

const escape = { command: 'rm -rf build', dangerouslyDisableSandbox: true }
const allowed: PermissionResult = { behavior: 'allow', updatedInput: {} }

describe('requireSandboxOverrideApproval', () => {
  beforeEach(() => {
    sandboxOn = true
    unsandboxedAllowed = true
    spyOn(SandboxManager, 'isSandboxingEnabled').mockImplementation(() => sandboxOn)
    spyOn(SandboxManager, 'areUnsandboxedCommandsAllowed').mockImplementation(() => unsandboxedAllowed)
  })

  afterEach(() => {
    // Restore the real methods so later test files see the live adapter.
    ;(SandboxManager.isSandboxingEnabled as unknown as { mockRestore(): void }).mockRestore()
    ;(SandboxManager.areUnsandboxedCommandsAllowed as unknown as { mockRestore(): void }).mockRestore()
  })

  test('turns an actual escape into a sandboxOverride ask', () => {
    expect(requireSandboxOverrideApproval(escape, allowed)).toEqual({
      behavior: 'ask',
      message: 'Run outside of the sandbox',
      decisionReason: {
        type: 'sandboxOverride',
        reason: 'dangerouslyDisableSandbox',
      },
    })
  })

  test('leaves calls without the flag alone', () => {
    const plain = { command: 'rm -rf build' }
    expect(requireSandboxOverrideApproval(plain, allowed)).toBe(allowed)
  })

  test('leaves deny and ask results alone', () => {
    const denied: PermissionResult = { behavior: 'deny', message: 'no', decisionReason: { type: 'other', reason: 'x' } }
    expect(requireSandboxOverrideApproval(escape, denied)).toBe(denied)
  })

  test('leaves a rule-decided allow alone', () => {
    const ruled: PermissionResult = {
      behavior: 'allow',
      updatedInput: {},
      decisionReason: { type: 'rule', rule: {} as never },
    }
    expect(requireSandboxOverrideApproval(escape, ruled)).toBe(ruled)
  })

  test('leaves a compound allow alone when every part is rule-decided', () => {
    const ruleAllow = { behavior: 'allow', updatedInput: {}, decisionReason: { type: 'rule', rule: {} } }
    const compound: PermissionResult = {
      behavior: 'allow',
      updatedInput: {},
      decisionReason: {
        type: 'subcommandResults',
        reasons: new Map([['a', ruleAllow as PermissionResult], ['b', ruleAllow as PermissionResult]]),
      },
    }
    expect(requireSandboxOverrideApproval(escape, compound)).toBe(compound)
  })

  test('leaves the call alone when sandboxing is off', () => {
    sandboxOn = false
    expect(requireSandboxOverrideApproval(escape, allowed)).toBe(allowed)
  })

  test('leaves the call alone when policy forbids unsandboxed commands', () => {
    unsandboxedAllowed = false
    expect(requireSandboxOverrideApproval(escape, allowed)).toBe(allowed)
  })
})
