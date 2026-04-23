// @ts-nocheck
import type { Command as CommanderCommand } from '@commander-js/extra-typings';

export type PreActionHandler = (
  thisCommand: CommanderCommand,
) => void | Promise<void>;

export function registerPreAction(
  program: CommanderCommand,
  handler: PreActionHandler,
): CommanderCommand {
  program.hook('preAction', handler);
  return program;
}
