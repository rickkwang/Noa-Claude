import { Command } from '@commander-js/extra-typings'
import { describe, expect, test } from 'bun:test'
import { configureProgramOptions } from '../../cli/programOptions.js'

describe('program options', () => {
  test('--effort accepts xhigh', () => {
    const program = new Command()
    configureProgramOptions(program)

    program.parse(['node', 'noa', '--effort', 'xhigh'], { from: 'node' })

    expect((program.opts() as { effort?: string }).effort).toBe('xhigh')
  })

  describe('--task-budget', () => {
    function parseTaskBudget(value: string): number | undefined {
      const program = new Command()
      program.exitOverride()
      // Commander writes the rejection to stderr before throwing; silence it
      // so the negative cases below don't spray the test output.
      program.configureOutput({ writeErr: () => {} })
      configureProgramOptions(program)
      program.parse(['node', 'noa', '--task-budget', value], { from: 'node' })
      return (program.opts() as { taskBudget?: number }).taskBudget
    }

    test('accepts the API minimum', () => {
      expect(parseTaskBudget('20000')).toBe(20_000)
    })

    test('accepts a value above the minimum', () => {
      expect(parseTaskBudget('64000')).toBe(64_000)
    })

    // Below the minimum the API returns a 400, so this has to fail locally
    // rather than reach the wire.
    test('rejects a below-minimum budget', () => {
      expect(() => parseTaskBudget('5000')).toThrow()
    })

    test('still rejects zero and non-integers', () => {
      expect(() => parseTaskBudget('0')).toThrow()
      expect(() => parseTaskBudget('abc')).toThrow()
    })
  })
})
