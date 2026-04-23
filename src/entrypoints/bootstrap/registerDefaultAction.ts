// @ts-nocheck
import type { Command as CommanderCommand } from '@commander-js/extra-typings';

export type DefaultActionHandler = (
  prompt: string | undefined,
  options: Record<string, unknown>,
) => void | Promise<void>;

export function registerDefaultAction(
  program: CommanderCommand,
  handler: DefaultActionHandler,
  version: string,
): CommanderCommand {
  program
    .action(handler)
    .version(version, '-v, --version', 'Output the version number');
  return program;
}
