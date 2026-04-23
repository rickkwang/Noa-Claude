// @ts-nocheck
import type { Command as CommanderCommand } from '@commander-js/extra-typings';

export function registerUtilityCommands(program: CommanderCommand): void {
  program
    .command('setup-token')
    .description(
      'Set up a long-lived authentication token (requires Claude subscription)',
    )
    .action(async () => {
      const [{ setupTokenHandler }, { createRoot }, { getBaseRenderOptions }] =
        await Promise.all([
          import('../../../cli/handlers/util.js'),
          import('../../../ink.js'),
          import('../../../utils/renderOptions.js'),
        ]);
      const root = await createRoot(getBaseRenderOptions(false));
      await setupTokenHandler(root);
    });

  program
    .command('agents')
    .description('List configured agents')
    .option(
      '--setting-sources <sources>',
      'Comma-separated list of setting sources to load (user, project, local).',
    )
    .action(async () => {
      const { agentsHandler } = await import('../../../cli/handlers/agents.js');
      await agentsHandler();
      process.exit(0);
    });
}
