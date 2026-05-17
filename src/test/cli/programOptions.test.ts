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
})
