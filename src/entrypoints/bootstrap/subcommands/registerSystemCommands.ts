// @ts-nocheck
import type { Command as CommanderCommand } from '@commander-js/extra-typings';

export function registerSystemCommands(program: CommanderCommand): void {
  // Doctor command - check installation health
  program
    .command('doctor')
    .description(
      'Check the health of your Noa Claude installation and settings. Note: the workspace trust dialog is skipped and stdio servers from project MCP config are spawned for health checks. Only use this command in directories you trust.',
    )
    .action(async () => {
      const [{ doctorHandler }, { createRoot }, { getBaseRenderOptions }] =
        await Promise.all([
          import('../../../cli/handlers/util.js'),
          import('../../../ink.js'),
          import('../../../utils/renderOptions.js'),
        ]);
      const root = await createRoot(getBaseRenderOptions(false));
      await doctorHandler(root);
    });

  // claude update
  //
  // For SemVer-compliant versioning with build metadata (X.X.X+SHA):
  // - We perform exact string comparison (including SHA) to detect any change
  // - This ensures users always get the latest build, even when only the SHA changes
  // - UI shows both versions including build metadata for clarity
  program
    .command('update')
    .alias('upgrade')
    .description('Check for updates and install if available')
    .action(async () => {
      const { update } = await import('src/cli/update.js');
      await update();
    });

  // claude up — run the project's CLAUDE.md "# claude up" setup instructions.
  if ("external" === 'ant') {
    program
      .command('up')
      .description(
        '[ANT-ONLY] Initialize or upgrade the local dev environment using the "# claude up" section of the nearest CLAUDE.md',
      )
      .action(async () => {
        const { up } = await import('src/cli/up.js');
        await up();
      });
  }

  // claude rollback (ant-only)
  // Rolls back to previous releases
  if ("external" === 'ant') {
    program
      .command('rollback [target]')
      .description(
        '[ANT-ONLY] Roll back to a previous release\n\nExamples:\n  claude rollback                                    Go 1 version back from current\n  claude rollback 3                                  Go 3 versions back from current\n  claude rollback 2.0.73-dev.20251217.t190658        Roll back to a specific version',
      )
      .option('-l, --list', 'List recent published versions with ages')
      .option('--dry-run', 'Show what would be installed without installing')
      .option(
        '--safe',
        'Roll back to the server-pinned safe version (set by oncall during incidents)',
      )
      .action(
        async (
          target?: string,
          options?: {
            list?: boolean;
            dryRun?: boolean;
            safe?: boolean;
          },
        ) => {
          const { rollback } = await import('src/cli/rollback.js');
          await rollback(target, options);
        },
      );
  }

  // claude install
  program
    .command('install [target]')
    .description(
      'Install Noa Claude native build. Use [target] to specify version (stable, latest, or specific version)',
    )
    .option('--force', 'Force installation even if already installed')
    .action(async (target: string | undefined, options: { force?: boolean }) => {
      const { installHandler } = await import('../../../cli/handlers/util.js');
      await installHandler(target, options);
    });
}
