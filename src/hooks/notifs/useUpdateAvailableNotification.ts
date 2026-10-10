import type { Notification } from 'src/context/notifications.js'
import { getGlobalConfig, isAutoUpdaterDisabled, saveGlobalConfig } from 'src/utils/config.js'
import { logForDebugging } from 'src/utils/debug.js'
import { usesCurlInstallerBuild } from 'src/utils/distribution.js'
import { getCurrentInstallationType } from 'src/utils/doctorDiagnostic.js'
import {
  fetchLatestReleaseTag,
  isCurrentVersionAtLeast,
  stripTagPrefix,
} from 'src/utils/latestRelease.js'
import { useStartupNotification } from './useStartupNotification.js'

// Release lookups go to the GitHub API: one success per day, and after a
// failure wait an hour before retrying instead of asking on every launch.
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const UPDATE_RETRY_INTERVAL_MS = 60 * 60 * 1000

/**
 * Tells the user a newer release exists. Notice only: the update itself stays
 * an explicit `noa update`, since it re-runs a remote installer script.
 */
export function useUpdateAvailableNotification(): void {
  useStartupNotification(getUpdateAvailableNotification)
}

async function getUpdateAvailableNotification(): Promise<Notification | null> {
  // Other install types have their own update path; DISABLE_UPDATES and
  // DISABLE_AUTOUPDATER / autoUpdates=false opt out of any update prompt.
  if (!usesCurlInstallerBuild() || isAutoUpdaterDisabled()) {
    return null
  }
  if ((await getCurrentInstallationType()) === 'development') {
    return null
  }

  const config = getGlobalConfig()
  let latestTag = config.updateCheckLatestTag ?? null
  const now = Date.now()
  const checkedRecently =
    config.updateCheckAt !== undefined &&
    now - config.updateCheckAt < UPDATE_CHECK_INTERVAL_MS
  const failedRecently =
    config.updateCheckFailedAt !== undefined &&
    now - config.updateCheckFailedAt < UPDATE_RETRY_INTERVAL_MS
  if (!checkedRecently && !failedRecently) {
    const fetchedTag = await fetchLatestReleaseTag()
    if (fetchedTag) {
      latestTag = fetchedTag
      saveGlobalConfig(current => ({
        ...current,
        updateCheckAt: Date.now(),
        updateCheckLatestTag: fetchedTag,
      }))
    } else {
      saveGlobalConfig(current => ({
        ...current,
        updateCheckFailedAt: Date.now(),
      }))
    }
  }

  // null means the running build is not a release version (dev build): say nothing.
  if (!latestTag || isCurrentVersionAtLeast(MACRO.VERSION, latestTag) !== false) {
    return null
  }

  logForDebugging(`Update available: ${latestTag} (current ${MACRO.VERSION})`)
  return {
    key: 'update-available',
    text: `Noa Claude ${stripTagPrefix(latestTag)} is available (you have ${MACRO.VERSION}). Run \`noa update\` to install it.`,
    color: 'success',
    priority: 'low',
    timeoutMs: 15000,
  }
}
