// @ts-nocheck
import type { Command as CommanderCommand } from '@commander-js/extra-typings';

export type SubcommandRegistrar = () => void;

export function registerSubcommands(
  program: CommanderCommand,
  register: SubcommandRegistrar,
): CommanderCommand {
  register();
  return program;
}
