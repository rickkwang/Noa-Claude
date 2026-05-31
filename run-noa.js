#!/usr/bin/env bun

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';

import {
  applyLauncherDefaults,
  DIAGNOSTIC_ERROR_CODES,
  formatDiagnosticError,
  LAUNCHER_MACRO,
  validateLauncherConfiguration,
} from './launcher-config.js';

function printAndExit(code, message) {
  console.error(formatDiagnosticError(code, message));
  process.exit(1);
}

try {
  applyLauncherDefaults();
  validateLauncherConfiguration(process.argv);
} catch (error) {
  printAndExit(
    DIAGNOSTIC_ERROR_CODES.CONFIG_ERROR,
    error?.message ?? String(error),
  );
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
    printAndExit(
      DIAGNOSTIC_ERROR_CODES.CONFIG_ERROR,
      `unable to change directory to ${cwdOverride}: ${error?.message ?? error}`,
    );
  }
}

globalThis.MACRO = LAUNCHER_MACRO;

const launcherDebugEnabled =
  process.env.CLAUDE_CODE_LAUNCHER_DEBUG === '1' ||
  process.env.CLAUDE_CODE_LAUNCHER_DEBUG === 'true';

const launcherAutoRebuildEnabled =
  process.env.CLAUDE_CODE_LAUNCHER_AUTO_REBUILD === '1' ||
  process.env.CLAUDE_CODE_LAUNCHER_AUTO_REBUILD === 'true';

process.on('unhandledRejection', (reason, promise) => {
  if (launcherDebugEnabled) {
    console.error('Unhandled rejection:', reason);
  }
});

process.on('uncaughtException', (error) => {
  if (launcherDebugEnabled) {
    console.error('Uncaught exception:', error.message, error.stack);
  }
});

const DIST_ENTRY = join(import.meta.dirname, 'dist', 'main.js');
const DIST_METADATA = `${DIST_ENTRY}.meta.json`;
const WATCH_PATHS = [
  join(import.meta.dirname, 'src'),
  join(import.meta.dirname, 'build.ts'),
  join(import.meta.dirname, 'launcher-config.js'),
  join(import.meta.dirname, 'package.json'),
];

function logLauncherDebug(message) {
  if (launcherDebugEnabled) {
    console.error(message);
  }
}

function getNewestMtimeMs(path) {
  if (!existsSync(path)) return 0;

  const stats = statSync(path);
  if (!stats.isDirectory()) {
    return stats.mtimeMs;
  }

  let newest = stats.mtimeMs;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const childPath = join(path, entry.name);
    const childNewest = getNewestMtimeMs(childPath);
    if (childNewest > newest) {
      newest = childNewest;
    }
  }
  return newest;
}

function getBundledMetadata() {
  if (!existsSync(DIST_METADATA)) return null;

  try {
    const raw = JSON.parse(readFileSync(DIST_METADATA, 'utf8'));
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    return {
      version: typeof raw.version === 'string' ? raw.version : null,
      displayVersion:
        typeof raw.displayVersion === 'string' ? raw.displayVersion : null,
      dev: raw.dev === true,
    };
  } catch {
    return null;
  }
}

function shouldRebuildDist() {
  if (!existsSync(join(import.meta.dirname, '.git'))) {
    return false;
  }

  if (!existsSync(DIST_ENTRY)) {
    logLauncherDebug('Launcher rebuild: dist/main.js is missing');
    return true;
  }

  const bundledMetadata = getBundledMetadata();
  if (!bundledMetadata) {
    logLauncherDebug('Launcher rebuild: dist metadata is missing or invalid');
    return true;
  }

  if (bundledMetadata.displayVersion !== LAUNCHER_MACRO.DISPLAY_VERSION) {
    logLauncherDebug(
      `Launcher rebuild: bundled display version ${bundledMetadata.displayVersion ?? 'unknown'} != launcher version ${LAUNCHER_MACRO.DISPLAY_VERSION}`,
    );
    return true;
  }

  if (bundledMetadata.dev) {
    logLauncherDebug('Launcher rebuild: dist/main.js was built in dev mode');
    return true;
  }

  const distMtime = getNewestMtimeMs(DIST_ENTRY);
  const sourceMtime = Math.max(...WATCH_PATHS.map(getNewestMtimeMs));
  if (sourceMtime > distMtime) {
    if (!launcherAutoRebuildEnabled) {
      logLauncherDebug(
        'Launcher rebuild: source files are newer than dist/main.js, but mtime-based rebuild is disabled',
      );
      return false;
    }
    logLauncherDebug('Launcher rebuild: source files are newer than dist/main.js');
    return true;
  }

  return false;
}

const REBUILD_LOCK = join(import.meta.dirname, 'dist', '.rebuild.lock');
const REBUILD_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
const REBUILD_POLL_MS = 250;

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

async function acquireRebuildLock() {
  mkdirSync(dirname(REBUILD_LOCK), { recursive: true });
  const deadline = Date.now() + REBUILD_WAIT_TIMEOUT_MS;
  while (true) {
    try {
      writeFileSync(REBUILD_LOCK, String(process.pid), { flag: 'wx' });
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }

    let raw = '';
    try {
      raw = readFileSync(REBUILD_LOCK, 'utf8').trim();
    } catch {
      // Lock disappeared between EEXIST and read — retry acquisition.
      continue;
    }

    const holderPid = raw ? parseInt(raw, 10) : NaN;
    const holderPidValid = Number.isInteger(holderPid) && holderPid > 0;

    if (holderPidValid && !isPidAlive(holderPid)) {
      // Stale lock from a build that crashed or was killed.
      try { unlinkSync(REBUILD_LOCK); } catch {}
      continue;
    }

    if (Date.now() > deadline) {
      return false;
    }

    // Empty/garbage content means another acquirer is mid-write (O_CREAT before
    // write completes); waiting lets them populate the PID rather than nuking
    // a live lock.
    if (holderPidValid) {
      logLauncherDebug(`Launcher rebuild: waiting on pid ${holderPid}`);
    } else {
      logLauncherDebug('Launcher rebuild: waiting for concurrent lock initialization');
    }
    await Bun.sleep(REBUILD_POLL_MS);
  }
}

function releaseRebuildLock() {
  try { unlinkSync(REBUILD_LOCK); } catch {}
}

async function rebuildDistIfNeeded() {
  if (!shouldRebuildDist()) return;

  const acquired = await acquireRebuildLock();
  if (!acquired) {
    printAndExit(
      DIAGNOSTIC_ERROR_CODES.RUNTIME_COMPAT_ERROR,
      `timed out waiting for concurrent build to finish`,
    );
  }

  try {
    // Another process may have completed the rebuild while we waited.
    if (!shouldRebuildDist()) return;

    logLauncherDebug('Launcher rebuild: running bun run build.ts');
    const proc = Bun.spawn({
      cmd: ['bun', 'run', 'build.ts'],
      cwd: import.meta.dirname,
      stdout: 'inherit',
      stderr: 'inherit',
      stdin: 'inherit',
    });

    const code = await proc.exited;
    if (code !== 0) {
      printAndExit(
        DIAGNOSTIC_ERROR_CODES.RUNTIME_COMPAT_ERROR,
        `failed to rebuild dist/main.js before launch (exit ${code})`,
      );
    }
  } finally {
    releaseRebuildLock();
  }
}

try {
  await rebuildDistIfNeeded();
  const m = await import('./dist/main.js');
  const result = m.main();
  if (result instanceof Promise) {
    result.then(() => {
      if (launcherDebugEnabled) {
        console.error('main() promise resolved');
      }
    }).catch((e) => {
      console.error('main() promise rejected:', e?.message ?? e);
    });
  }
} catch (e) {
  printAndExit(
    DIAGNOSTIC_ERROR_CODES.RUNTIME_COMPAT_ERROR,
    `Error during import or main(): ${e?.message ?? e}`,
  );
}
