import { expect, test } from 'bun:test'
import {
  isProviderManagedEnvVar,
  SAFE_ENV_VARS,
} from '../../utils/managedEnvConstants.js'

test('recognizes the official Fable and custom capability environment pairs', () => {
  expect(
    isProviderManagedEnvVar(
      'ANTHROPIC_DEFAULT_FABLE_MODEL_SUPPORTED_CAPABILITIES',
    ),
  ).toBe(true)
  expect(
    SAFE_ENV_VARS.has('ANTHROPIC_DEFAULT_FABLE_MODEL_SUPPORTED_CAPABILITIES'),
  ).toBe(true)
  expect(
    SAFE_ENV_VARS.has('ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES'),
  ).toBe(true)
})

test('allows the Noa third-party prompt policy in managed settings', () => {
  expect(SAFE_ENV_VARS.has('NOA_CLAUDE_THIRD_PARTY_PROMPT_POLICY')).toBe(true)
})
