// @ts-nocheck
import { Command as CommanderCommand, Option } from '@commander-js/extra-typings';

function getOptionSortKey(option: Option): string {
  return option.long?.replace(/^--/, '') ?? option.short?.replace(/^-/, '') ?? '';
}

export function createSortedHelpConfig(): {
  sortSubcommands: true;
  sortOptions: true;
  compareOptions: (a: Option, b: Option) => number;
} {
  return Object.assign(
    {
      sortSubcommands: true,
      sortOptions: true,
    } as const,
    {
      compareOptions: (a: Option, b: Option) =>
        getOptionSortKey(a).localeCompare(getOptionSortKey(b)),
    },
  );
}

export type SortedHelpConfig = ReturnType<typeof createSortedHelpConfig>;
export type SortedHelpConfigFactory = typeof createSortedHelpConfig;

export function buildProgram(): CommanderCommand {
  return new CommanderCommand()
    .configureHelp(createSortedHelpConfig())
    .enablePositionalOptions();
}
