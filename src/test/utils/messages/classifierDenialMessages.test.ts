import { describe, expect, test } from 'bun:test'
import {
  buildClassifierRefusalMessage,
  buildClassifierUnavailableMessage,
  buildYoloRejectionMessage,
  DENIAL_WORKAROUND_GUIDANCE,
  isClassifierDenial,
} from '../../../utils/messages.js'

describe('buildClassifierRefusalMessage', () => {
  test('omits the workaround guidance', () => {
    // A safeguard refusal keys off conversation content, so "attempt this
    // action using other tools" sends the agent into retries that can never
    // clear it — and read as evasion of the refusal.
    expect(buildClassifierRefusalMessage('safety refusal')).not.toContain(
      DENIAL_WORKAROUND_GUIDANCE,
    )
  })

  test('keeps the prefix the UI matches on', () => {
    expect(isClassifierDenial(buildClassifierRefusalMessage('reason'))).toBe(
      true,
    )
  })
})

describe('buildClassifierUnavailableMessage', () => {
  test('omits the workaround guidance', () => {
    expect(
      buildClassifierUnavailableMessage('Bash', 'claude-haiku-4-5'),
    ).not.toContain(DENIAL_WORKAROUND_GUIDANCE)
  })
})

describe('buildYoloRejectionMessage', () => {
  test('is detected by the UI as a classifier denial', () => {
    expect(isClassifierDenial(buildYoloRejectionMessage('reason', 'Bash'))).toBe(
      true,
    )
  })

  test('offers a rule hint only when a rule can name the tool', () => {
    expect(buildYoloRejectionMessage('reason', 'Bash')).toContain(
      'add a permission rule for Bash to their settings.',
    )
    expect(buildYoloRejectionMessage('reason')).not.toContain('permission rule')
  })
})
