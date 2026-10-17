// @ts-nocheck
import chalk from 'chalk'
import { sep } from 'node:path'
import { logEvent } from 'src/services/analytics/index.js'
import {
  getLatestVersion,
  type InstallStatus,
  installGlobalPackage,
} from 'src/utils/autoUpdater.js'
import { regenerateCompletionCache } from 'src/utils/completionCache.js'
import {
  getGlobalConfig,
  type InstallMethod,
  saveGlobalConfig,
} from 'src/utils/config.js'
import { logForDebugging } from 'src/utils/debug.js'
import { getDoctorDiagnostic } from 'src/utils/doctorDiagnostic.js'
import {
  canonicalPath,
  curlInstallerUrl,
  getOwnInstallRoot,
  NOA_CURL_INSTALL_COMMAND,
  usesCurlInstallerBuild,
} from 'src/utils/distribution.js'
import { getClaudeConfigHomeDir } from 'src/utils/envUtils.js'
import { gracefulShutdown } from 'src/utils/gracefulShutdown.js'
import {
  fetchLatestReleaseTag,
  hasExplicitInstallSource,
  isCurrentVersionAtLeast,
  stripTagPrefix,
} from 'src/utils/latestRelease.js'
import {
  installOrUpdateClaudePackage,
  localInstallationExists,
} from 'src/utils/localInstaller.js'
import {
  installLatest as installLatestNative,
  removeInstalledSymlink,
} from 'src/utils/nativeInstaller/index.js'
import { getPackageManager } from 'src/utils/nativeInstaller/packageManagers.js'
import { writeToStdout } from 'src/utils/process.js'
import { gte } from 'src/utils/semver.js'
import { getInitialSettings } from 'src/utils/settings/settings.js'

async function confirmYesNo(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false
  const { createInterface } = await import('node:readline')
  return await new Promise<boolean>(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(prompt, answer => {
      rl.close()
      resolve(/^y(es)?$/i.test(answer.trim()))
    })
  })
}

async function runCurlReinstall(autoConfirm: boolean): Promise<void> {
  // Reinstall over the copy that is running, not wherever the global link points.
  // Without an identity, guessing a target could leave the real install behind.
  const installDir = getOwnInstallRoot()
  if (!installDir) {
    writeToStdout(
      'This copy is not an installed Noa Claude, so it cannot tell where to update.\n' +
        'Update from the installed launcher instead: noa update\n',
    )
    await gracefulShutdown(1)
    return
  }
  const configDir = canonicalPath(getClaudeConfigHomeDir())
  if (configDir === installDir || configDir.startsWith(installDir + sep)) {
    writeToStdout(
      `Refusing to update: config ${configDir} is inside installation directory ${installDir}.\n` +
        'Move your config outside the installation directory before updating.\n',
    )
    await gracefulShutdown(1)
    return
  }
  writeToStdout('\n')
  writeToStdout(
    'Noa Claude updates by re-running the curl installer.\n',
  )

  // The installer script comes from the release it installs, not from master:
  // master can carry changes that no release has shipped. NOA_INSTALL_REF names
  // the release explicitly; escape-hatch sources without a ref keep master.
  let scriptRef = process.env.NOA_INSTALL_REF || 'master'
  if (!hasExplicitInstallSource()) {
    const latestTag = await fetchLatestReleaseTag()
    if (!latestTag) {
      // Without the latest tag the target is unknown, and the installer's own
      // fallback could be older than this copy. Refuse rather than guess.
      writeToStdout(
        chalk.red(
          'Could not determine the latest release (GitHub unreachable or rate-limited). Not updating.',
        ) + '\n',
      )
      writeToStdout('To choose a release yourself: NOA_INSTALL_REF=<tag> noa update\n')
      await gracefulShutdown(1)
      return
    }
    scriptRef = latestTag
    const upToDate = isCurrentVersionAtLeast(MACRO.VERSION, latestTag)
    if (upToDate) {
      writeToStdout(
        chalk.green(`Noa Claude is up to date (${MACRO.VERSION})`) + '\n',
      )
      writeToStdout('To repair a corrupted install, re-run the installer:\n')
      writeToStdout(chalk.bold(`  ${NOA_CURL_INSTALL_COMMAND}\n`))
      await gracefulShutdown(0)
      return
    }
    if (upToDate === null) {
      writeToStdout(
        chalk.yellow(
          `Current version (${MACRO.VERSION}) is not a release version; proceeding without a version check.`,
        ) + '\n',
      )
    } else {
      writeToStdout(
        `New version available: ${stripTagPrefix(latestTag)} (current: ${MACRO.VERSION})\n`,
      )
    }
  }

  const scriptUrl = curlInstallerUrl(scriptRef)
  writeToStdout('Command:\n')
  writeToStdout(chalk.bold(`  curl -fsSL ${scriptUrl} | bash\n`))
  writeToStdout('\n')

  const proceed =
    autoConfirm || (await confirmYesNo('Run this now? [y/N] '))
  if (!proceed) {
    const nonInteractive = !process.stdin.isTTY
    writeToStdout(nonInteractive
      ? 'Aborted: no terminal to confirm. Re-run with --yes.\n'
      : 'Aborted. Run the command above to update manually.\n')
    await gracefulShutdown(nonInteractive ? 1 : 0)
    return
  }

  const { spawn } = await import('node:child_process')
  const code: number = await new Promise(resolve => {
    // The URL is passed as $1, not spliced into the script: NOA_INSTALL_REF comes
    // from the environment. pipefail: a failed download must fail the update.
    const child = spawn(
      'bash',
      ['-o', 'pipefail', '-c', 'curl -fsSL "$1" | bash', 'noa-update', scriptUrl],
      {
        stdio: 'inherit',
        env: { ...process.env, NOA_INSTALL_TARGET_DIR: installDir },
      },
    )
    child.on('exit', c => resolve(c ?? 1))
    child.on('error', err => {
      process.stderr.write(`Failed to spawn installer: ${err.message}\n`)
      resolve(1)
    })
  })
  await gracefulShutdown(code)
}

export async function update(options: { yes?: boolean } = {}) {
  logEvent('tengu_update_check', {})
  writeToStdout(`Current version: ${MACRO.VERSION}\n`)

  const channel = getInitialSettings()?.autoUpdatesChannel ?? 'latest'
  writeToStdout(`Checking for updates to ${channel} version...\n`)

  logForDebugging('update: Starting update check')

  if (usesCurlInstallerBuild()) {
    await runCurlReinstall(options.yes === true)
    return
  }

  // Run diagnostic to detect potential issues
  logForDebugging('update: Running diagnostic')
  const diagnostic = await getDoctorDiagnostic()
  logForDebugging(`update: Installation type: ${diagnostic.installationType}`)
  logForDebugging(
    `update: Config install method: ${diagnostic.configInstallMethod}`,
  )

  if (diagnostic.multipleInstallations.length > 1) {
    writeToStdout('\n')
    writeToStdout(chalk.yellow('Warning: Multiple installations found') + '\n')
    for (const install of diagnostic.multipleInstallations) {
      const current =
        diagnostic.installationType === install.type
          ? ' (currently running)'
          : ''
      writeToStdout(`- ${install.type} at ${install.path}${current}\n`)
    }
  }

  // Display warnings if any exist
  if (diagnostic.warnings.length > 0) {
    writeToStdout('\n')
    for (const warning of diagnostic.warnings) {
      logForDebugging(`update: Warning detected: ${warning.issue}`)

      // Don't skip PATH warnings - they're always relevant
      // The user needs to know that 'which claude' points elsewhere
      logForDebugging(`update: Showing warning: ${warning.issue}`)

      writeToStdout(chalk.yellow(`Warning: ${warning.issue}\n`))

      writeToStdout(chalk.bold(`Fix: ${warning.fix}\n`))
    }
  }

  const config = getGlobalConfig()
  if (
    !config.installMethod &&
    diagnostic.installationType !== 'package-manager'
  ) {
    writeToStdout('\n')
    writeToStdout('Updating configuration to track installation method...\n')
    let detectedMethod: 'local' | 'native' | 'global' | 'unknown' = 'unknown'

    switch (diagnostic.installationType) {
      case 'npm-local':
        detectedMethod = 'local'
        break
      case 'native':
        detectedMethod = 'native'
        break
      case 'npm-global':
        detectedMethod = 'global'
        break
      default:
        detectedMethod = 'unknown'
    }

    saveGlobalConfig(current => ({
      ...current,
      installMethod: detectedMethod,
    }))
    writeToStdout(`Installation method set to: ${detectedMethod}\n`)
  }

  if (diagnostic.installationType === 'development') {
    writeToStdout('\n')
    writeToStdout(
      chalk.yellow('Warning: Cannot update development build') + '\n',
    )
    await gracefulShutdown(1)
  }

  if (diagnostic.installationType === 'package-manager') {
    const packageManager = await getPackageManager()
    writeToStdout('\n')

    if (packageManager === 'homebrew') {
      writeToStdout('Noa Claude is managed by Homebrew.\n')
      const latest = await getLatestVersion(channel)
      if (latest && !gte(MACRO.VERSION, latest)) {
        writeToStdout(`Update available: ${MACRO.VERSION} → ${latest}\n`)
        writeToStdout('\n')
        writeToStdout('To update, run:\n')
        writeToStdout(chalk.bold('  brew upgrade noa') + '\n')
      } else {
        writeToStdout('Noa Claude is up to date!\n')
      }
    } else if (packageManager === 'winget') {
      writeToStdout('Noa Claude is managed by winget.\n')
      const latest = await getLatestVersion(channel)
      if (latest && !gte(MACRO.VERSION, latest)) {
        writeToStdout(`Update available: ${MACRO.VERSION} → ${latest}\n`)
        writeToStdout('\n')
        writeToStdout('To update, run:\n')
        writeToStdout(
          chalk.bold('  winget upgrade Noa.Claude') + '\n',
        )
      } else {
        writeToStdout('Noa Claude is up to date!\n')
      }
    } else if (packageManager === 'apk') {
      writeToStdout('Noa Claude is managed by apk.\n')
      const latest = await getLatestVersion(channel)
      if (latest && !gte(MACRO.VERSION, latest)) {
        writeToStdout(`Update available: ${MACRO.VERSION} → ${latest}\n`)
        writeToStdout('\n')
        writeToStdout('To update, run:\n')
        writeToStdout(chalk.bold('  apk upgrade noa') + '\n')
      } else {
        writeToStdout('Noa Claude is up to date!\n')
      }
    } else {
      // pacman, deb, and rpm don't get specific commands because they each have
      // multiple frontends (pacman: yay/paru/makepkg, deb: apt/apt-get/aptitude/nala,
      // rpm: dnf/yum/zypper)
      writeToStdout('Noa Claude is managed by a package manager.\n')
      writeToStdout('Please use your package manager to update.\n')
    }

    await gracefulShutdown(0)
  }

  if (
    config.installMethod &&
    diagnostic.configInstallMethod !== 'not set' &&
    diagnostic.installationType !== 'package-manager'
  ) {
    const runningType = diagnostic.installationType
    const configExpects = diagnostic.configInstallMethod

    const typeMapping: Record<string, string> = {
      'npm-local': 'local',
      'npm-global': 'global',
      native: 'native',
      development: 'development',
      unknown: 'unknown',
    }

    const normalizedRunningType = typeMapping[runningType] || runningType

    if (
      normalizedRunningType !== configExpects &&
      configExpects !== 'unknown'
    ) {
      writeToStdout('\n')
      writeToStdout(chalk.yellow('Warning: Configuration mismatch') + '\n')
      writeToStdout(`Config expects: ${configExpects} installation\n`)
      writeToStdout(`Currently running: ${runningType}\n`)
      writeToStdout(
        chalk.yellow(
          `Updating the ${runningType} installation you are currently using`,
        ) + '\n',
      )

      saveGlobalConfig(current => ({
        ...current,
        installMethod: normalizedRunningType as InstallMethod,
      }))
      writeToStdout(
        `Config updated to reflect current installation method: ${normalizedRunningType}\n`,
      )
    }
  }

  if (diagnostic.installationType === 'native') {
    logForDebugging(
      'update: Detected native installation, using native updater',
    )
    try {
      const result = await installLatestNative(channel, true)

      if (result.lockFailed) {
        const pidInfo = result.lockHolderPid
          ? ` (PID ${result.lockHolderPid})`
          : ''
        writeToStdout(
          chalk.yellow(
            `Another Noa Claude process${pidInfo} is currently running. Please try again in a moment.`,
          ) + '\n',
        )
        await gracefulShutdown(0)
      }

      if (!result.latestVersion) {
        process.stderr.write('Failed to check for updates\n')
        await gracefulShutdown(1)
      }

      if (result.latestVersion === MACRO.VERSION) {
        writeToStdout(
          chalk.green(`Noa Claude is up to date (${MACRO.VERSION})`) + '\n',
        )
      } else {
        writeToStdout(
          chalk.green(
            `Successfully updated from ${MACRO.VERSION} to version ${result.latestVersion}`,
          ) + '\n',
        )
        await regenerateCompletionCache()
      }
      await gracefulShutdown(0)
    } catch (error) {
      process.stderr.write('Error: Failed to install native update\n')
      process.stderr.write(String(error) + '\n')
      process.stderr.write('Try running "noa doctor" for diagnostics\n')
      await gracefulShutdown(1)
    }
  }

  // Fallback to existing JS/npm-based update logic
  // Remove native installer symlink since we're not using native installation
  // But only if user hasn't migrated to native installation
  if (config.installMethod !== 'native') {
    await removeInstalledSymlink()
  }

  logForDebugging('update: Checking npm registry for latest version')
  logForDebugging(`update: Package URL: ${MACRO.PACKAGE_URL}`)
  const npmTag = channel === 'stable' ? 'stable' : 'latest'
  const npmCommand = `npm view ${MACRO.PACKAGE_URL}@${npmTag} version`
  logForDebugging(`update: Running: ${npmCommand}`)
  const latestVersion = await getLatestVersion(channel)
  logForDebugging(
    `update: Latest version from npm: ${latestVersion || 'FAILED'}`,
  )

  if (!latestVersion) {
    logForDebugging('update: Failed to get latest version from npm registry')
    process.stderr.write(chalk.red('Failed to check for updates') + '\n')
    process.stderr.write('Unable to fetch latest version from npm registry\n')
    process.stderr.write('\n')
    process.stderr.write('Possible causes:\n')
    process.stderr.write('  • Network connectivity issues\n')
    process.stderr.write('  • npm registry is unreachable\n')
    process.stderr.write('  • Corporate proxy/firewall blocking npm\n')
    if (MACRO.PACKAGE_URL && !MACRO.PACKAGE_URL.startsWith('@anthropic')) {
      process.stderr.write(
        '  • Internal/development build not published to npm\n',
      )
    }
    process.stderr.write('\n')
    process.stderr.write('Try:\n')
    process.stderr.write('  • Check your internet connection\n')
    process.stderr.write('  • Run with --debug flag for more details\n')
    const packageName =
      MACRO.PACKAGE_URL ||
      (process.env.USER_TYPE === 'ant'
        ? '@anthropic-ai/claude-cli'
        : '@anthropic-ai/claude-code')
    process.stderr.write(
      `  • Manually check: npm view ${packageName} version\n`,
    )

    process.stderr.write('  • Check if you need to login: npm whoami\n')
    await gracefulShutdown(1)
  }

  if (latestVersion === MACRO.VERSION) {
    writeToStdout(
      chalk.green(`Noa Claude is up to date (${MACRO.VERSION})`) + '\n',
    )
    await gracefulShutdown(0)
  }

  writeToStdout(
    `New version available: ${latestVersion} (current: ${MACRO.VERSION})\n`,
  )
  writeToStdout('Installing update...\n')

  let useLocalUpdate = false
  let updateMethodName = ''

  switch (diagnostic.installationType) {
    case 'npm-local':
      useLocalUpdate = true
      updateMethodName = 'local'
      break
    case 'npm-global':
      useLocalUpdate = false
      updateMethodName = 'global'
      break
    case 'unknown': {
      // Fallback to detection if we can't determine installation type
      const isLocal = await localInstallationExists()
      useLocalUpdate = isLocal
      updateMethodName = isLocal ? 'local' : 'global'
      writeToStdout(
        chalk.yellow('Warning: Could not determine installation type') + '\n',
      )
      writeToStdout(
        `Attempting ${updateMethodName} update based on file detection...\n`,
      )
      break
    }
    default:
      process.stderr.write(
        `Error: Cannot update ${diagnostic.installationType} installation\n`,
      )
      await gracefulShutdown(1)
  }

  writeToStdout(`Using ${updateMethodName} installation update method...\n`)

  logForDebugging(`update: Update method determined: ${updateMethodName}`)
  logForDebugging(`update: useLocalUpdate: ${useLocalUpdate}`)

  let status: InstallStatus

  if (useLocalUpdate) {
    logForDebugging(
      'update: Calling installOrUpdateClaudePackage() for local update',
    )
    status = await installOrUpdateClaudePackage(channel)
  } else {
    logForDebugging('update: Calling installGlobalPackage() for global update')
    status = await installGlobalPackage()
  }

  logForDebugging(`update: Installation status: ${status}`)

  switch (status) {
    case 'success':
      writeToStdout(
        chalk.green(
          `Successfully updated from ${MACRO.VERSION} to version ${latestVersion}`,
        ) + '\n',
      )
      await regenerateCompletionCache()
      break
    case 'no_permissions':
      process.stderr.write(
        'Error: Insufficient permissions to install update\n',
      )
      process.stderr.write('Reinstall with:\n')
      process.stderr.write(
        `  ${NOA_CURL_INSTALL_COMMAND}\n`,
      )
      await gracefulShutdown(1)
      break
    case 'install_failed':
      process.stderr.write('Error: Failed to install update\n')
      process.stderr.write('Reinstall with:\n')
      process.stderr.write(`  ${NOA_CURL_INSTALL_COMMAND}\n`)
      await gracefulShutdown(1)
      break
    case 'in_progress':
      process.stderr.write(
        'Error: Another instance is currently performing an update\n',
      )
      process.stderr.write('Please wait and try again later\n')
      await gracefulShutdown(1)
      break
  }
  await gracefulShutdown(0)
}
