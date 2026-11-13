#!/usr/bin/env bun

import {
  applyLauncherDefaults,
  DEFAULT_CONFIG_DIR,
  LAUNCHER_MACRO,
  validateLauncherConfiguration,
} from './launcher-config.js';

const launcherArgs = process.argv.slice(2);
const infoOnly = launcherArgs.some(arg =>
  ['-h', '--help', '-v', '-V', '--version'].includes(arg),
);
const versionOnly = launcherArgs.length === 1 &&
  ['-v', '-V', '--version'].includes(launcherArgs[0]);
if (launcherArgs[0] === 'uninstall' || versionOnly) {
  process.env.CLAUDE_CONFIG_DIR = DEFAULT_CONFIG_DIR;
} else {
  const resolvedLauncherConfig = applyLauncherDefaults({
    skipGlobalConfig: infoOnly,
  });
  validateLauncherConfiguration(process.argv, resolvedLauncherConfig);
}

function getFlagValue(argv, flagNames) {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    for (const flagName of flagNames) {
      if (arg === flagName) {
        const next = args[i + 1];
        return typeof next === 'string' ? next : null;
      }
      if (arg.startsWith(`${flagName}=`)) {
        return arg.slice(flagName.length + 1);
      }
    }
  }
  return null;
}

const cwdOverride = getFlagValue(process.argv, ['--cwd', '-C']);
if (cwdOverride) {
  try {
    process.chdir(cwdOverride);
  } catch (error) {
    console.error(
      `Error: unable to change directory to ${cwdOverride}:`,
      error?.message ?? error,
    );
    process.exit(1);
  }
}

globalThis.MACRO = LAUNCHER_MACRO;

const launcherDebugEnabled =
  process.env.CLAUDE_CODE_LAUNCHER_DEBUG === '1' ||
  process.env.CLAUDE_CODE_LAUNCHER_DEBUG === 'true';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error.message, error.stack);
});

try {
  const m = await import('./src/entrypoints/cli.tsx');
  const result = m.bootstrapCli();
  if (result instanceof Promise) {
    result.then(() => {
      if (launcherDebugEnabled) {
        console.error('main() promise resolved');
      }
    }).catch((e) => {
      console.error('main() promise rejected:', e?.message ?? e);
      process.exit(1);
    });
  }
} catch (e) {
  console.error('Error during import or main():', e.message, e.stack);
}
