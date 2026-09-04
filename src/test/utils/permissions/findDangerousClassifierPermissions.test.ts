import { describe, expect, test } from 'bun:test'
import { findDangerousClassifierPermissions } from '../../../utils/permissions/permissionSetup.js'

const specs = (cliAllowedTools: string[]) =>
  findDangerousClassifierPermissions([], cliAllowedTools).map(d => d.ruleDisplay)

describe('findDangerousClassifierPermissions — CLI --allowed-tools', () => {
  test('flags tool-wide Bash grants and displays them uniformly', () => {
    expect(specs(['Bash'])).toEqual(['Bash(*)'])
    expect(specs(['Bash(*)'])).toEqual(['Bash(*)'])
    expect(specs(['Bash()'])).toEqual(['Bash(*)'])
  })

  test('flags dangerous prefixes and echoes the spec as written', () => {
    expect(specs(['Bash(python:*)'])).toEqual(['Bash(python:*)'])
    expect(specs(['Bash(bash *)'])).toEqual(['Bash(bash *)'])
  })

  test('leaves narrow grants alone', () => {
    expect(specs(['Bash(npm run test:*)', 'Read(//tmp/**)'])).toEqual([])
  })

  // Regression: the old inline /^([^(]+)(?:\(([^)]*)\))?$/ did not match a spec
  // whose content held a parenthesis, and an unmatched spec was skipped by
  // `if (match)` — so a dangerous grant was silently not reported.
  test('flags a grant whose content contains parentheses', () => {
    expect(specs(['Agent(reviewer (v2))'])).toEqual(['Agent(reviewer (v2))'])
    expect(specs(['Agent(reviewer \\(v2\\))'])).toEqual([
      'Agent(reviewer \\(v2\\))',
    ])
  })

  // Regression: the old regex was anchored to the raw spec, so any surrounding
  // whitespace made it fail to match and the grant went unreported.
  test('flags a grant written with surrounding whitespace', () => {
    expect(specs([' Bash(python:*) '])).toEqual([' Bash(python:*) '])
  })

  test('reports the tool name for rules loaded from settings', () => {
    const found = findDangerousClassifierPermissions(
      [
        {
          source: 'userSettings',
          ruleBehavior: 'allow',
          ruleValue: { toolName: 'Bash' },
        },
        {
          source: 'userSettings',
          ruleBehavior: 'deny',
          ruleValue: { toolName: 'Bash' },
        },
      ],
      [],
    )
    expect(found.map(d => d.ruleDisplay)).toEqual(['Bash(*)'])
    expect(found[0]?.sourceDisplay).not.toBe('--allowed-tools')
  })
})
