// @ts-nocheck
import chalk from 'chalk'
import { lstat, readlink, rm, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { logEvent } from 'src/services/analytics/index.js'
import { logForDebugging } from 'src/utils/debug.js'
import { canonicalPath, getOwnInstallRoot } from 'src/utils/distribution.js'
import { getClaudeConfigHomeDir } from 'src/utils/envUtils.js'
import { gracefulShutdown } from 'src/utils/gracefulShutdown.js'
import { cleanupShellAliases } from 'src/utils/nativeInstaller/index.js'
import { writeToStdout } from 'src/utils/process.js'

interface UninstallOptions {
  purge?: boolean
  yes?: boolean
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return true
  } catch {
    return false
  }
}

async function symlinkTargetsInto(
  symlinkPath: string,
  parentDir: string,
): Promise<boolean> {
  try {
    const stat = await lstat(symlinkPath)
    if (!stat.isSymbolicLink()) return false
    const raw = await readlink(symlinkPath)
    // Canonical on both sides: the link and the running copy may spell the same
    // directory differently (/tmp vs /private/tmp).
    const target = canonicalPath(resolve(symlinkPath, '..', raw))
    const parent = canonicalPath(parentDir)
    return target === parent || target.startsWith(parent + sep)
  } catch {
    return false
  }
}

function isDefaultConfigDir(dir: string): boolean {
  return canonicalPath(dir) === canonicalPath(join(homedir(), '.noa'))
}

async function confirmYesNo(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false
  const { createInterface } = await import('node:readline')
  return await new Promise<boolean>(res => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(prompt, answer => {
      rl.close()
      res(/^y(es)?$/i.test(answer.trim()))
    })
  })
}

export async function uninstall(
  options: UninstallOptions = {},
): Promise<void> {
  logEvent('tengu_uninstall_command', { purge: String(!!options.purge) })

  const configHome = getClaudeConfigHomeDir()
  const installDir = getOwnInstallRoot()
  if (!installDir) {
    writeToStdout(
      'This copy is not an installed Noa Claude, so nothing was removed.\n' +
        'Run `noa uninstall` from the installed copy (~/.noa/install).\n',
    )
    await gracefulShutdown(1)
    return
  }
  // --purge only removes the default ~/.noa. A custom config directory may hold
  // data that is not Noa's, so the user deletes it by hand.
  if (options.purge && !isDefaultConfigDir(configHome)) {
    writeToStdout(
      `Refusing to purge ${configHome}: only the default ~/.noa is removed automatically.\n` +
        `To delete it yourself: rm -rf ${configHome}\n`,
    )
    await gracefulShutdown(1)
    return
  }
  const binDir = join(homedir(), '.local', 'bin')
  const symlinkCandidates = [
    join(binDir, 'noa'),
    join(binDir, 'claude-agent'),
  ]

  const installDirExists = await pathExists(installDir)
  const symlinksToRemove: string[] = []
  for (const link of symlinkCandidates) {
    if (await symlinkTargetsInto(link, installDir)) {
      symlinksToRemove.push(link)
    }
  }

  if (!installDirExists && symlinksToRemove.length === 0 && !options.purge) {
    writeToStdout('Nothing to uninstall.\n')
    writeToStdout(
      `Did not find ${installDir} or any symlink pointing into it.\n`,
    )
    await gracefulShutdown(0)
    return
  }

  writeToStdout('\nNoa Claude uninstall plan:\n')
  for (const link of symlinksToRemove) {
    writeToStdout(`  remove symlink  ${link}\n`)
  }
  if (installDirExists) {
    writeToStdout(`  remove dir      ${installDir}\n`)
  }
  writeToStdout('  scrub shell aliases (.bashrc / .zshrc)\n')
  if (options.purge) {
    writeToStdout(
      chalk.yellow(
        `  PURGE config    ${configHome}  (settings, plugins, history)\n`,
      ),
    )
  } else {
    writeToStdout(
      `  keep config     ${configHome}  (pass --purge to remove)\n`,
    )
  }
  writeToStdout('\n')

  const proceed =
    options.yes === true || (await confirmYesNo('Proceed? [y/N] '))
  if (!proceed) {
    writeToStdout('Aborted.\n')
    await gracefulShutdown(0)
    return
  }

  let failed = false
  for (const link of symlinksToRemove) {
    try {
      await unlink(link)
      writeToStdout(`removed ${link}\n`)
    } catch (err) {
      failed = true
      process.stderr.write(
        `Failed to remove ${link}: ${(err as Error).message}\n`,
      )
    }
  }

  if (installDirExists) {
    try {
      await rm(installDir, { recursive: true, force: true })
      writeToStdout(`removed ${installDir}\n`)
    } catch (err) {
      failed = true
      process.stderr.write(
        `Failed to remove ${installDir}: ${(err as Error).message}\n`,
      )
    }
  }

  try {
    const messages = await cleanupShellAliases()
    for (const m of messages) {
      writeToStdout(`${m.message}\n`)
    }
  } catch (err) {
    logForDebugging(
      `uninstall: cleanupShellAliases failed: ${(err as Error).message}`,
    )
  }

  if (options.purge) {
    if (await pathExists(configHome)) {
      try {
        await rm(configHome, { recursive: true, force: true })
        writeToStdout(`removed ${configHome}\n`)
      } catch (err) {
        failed = true
        process.stderr.write(
          `Failed to remove ${configHome}: ${(err as Error).message}\n`,
        )
      }
    }
  }

  writeToStdout('\n')
  if (failed) {
    writeToStdout(
      'Uninstall finished with errors. Inspect the messages above and clean up manually if needed.\n',
    )
    await gracefulShutdown(1)
    return
  }

  writeToStdout('Noa Claude uninstalled.\n')
  if (!options.purge) {
    writeToStdout(
      `Config preserved at ${configHome}. Run \`rm -rf ${configHome}\` to fully remove.\n`,
    )
  }
  writeToStdout(
    'If you added `export PATH="$HOME/.local/bin:$PATH"` to your shell profile, remove it manually.\n',
  )
  await gracefulShutdown(0)
}
