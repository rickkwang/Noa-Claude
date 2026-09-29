import type { Command } from '../types/command.js'

/** Whether `cmd`, invoked with `args`, runs without waiting for a stop point. */
export function isImmediateCommand(cmd: Pick<Command, 'immediate'>, args: string): boolean {
  return typeof cmd.immediate === 'function' ? cmd.immediate(args) : cmd.immediate === true
}
