import { resolve } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import type { ToolPermissionContext } from '../../Tool.js'
import type { AdditionalWorkingDirectory } from '../../types/permissions.js'
import { expandPath } from '../path.js'
import { parseSettingsFile } from '../settings/settings.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import { loadAllPermissionRulesFromDisk } from './permissionsLoader.js'
import { syncPermissionRulesFromDisk } from './permissions.js'
import {
  isProjectGrantSourceGated,
  projectSettingsFilesFor,
} from './projectGrants.js'

/** Directories the project settings of `directory` declare, resolved to absolute paths. */
function declaredProjectDirectories(directory: string): string[] {
  return projectSettingsFilesFor(directory).flatMap(({ path }) =>
    (parseSettingsFile(path).settings?.permissions?.additionalDirectories ?? []).map(
      entry => resolve(directory, expandPath(entry)),
    ),
  )
}

/**
 * Re-derives the project-scoped part of the permission context for the current
 * workspace: project/local allow rules, and the directories their settings
 * declare. `previousDirectory` is the workspace the context was built for; its
 * declared directories are dropped first, then the current workspace's
 * ungated ones are added.
 */
export function syncProjectGrants(
  context: ToolPermissionContext,
  previousDirectory: string,
): ToolPermissionContext {
  resetSettingsCache()
  const directory = getOriginalCwd()
  const directories = new Map(context.additionalWorkingDirectories)
  for (const path of declaredProjectDirectories(previousDirectory)) {
    directories.delete(path)
  }
  for (const { path, source } of projectSettingsFilesFor(directory)) {
    if (isProjectGrantSourceGated(source)) continue
    const settings = parseSettingsFile(path).settings
    for (const entry of settings?.permissions?.additionalDirectories ?? []) {
      const absolute = resolve(directory, expandPath(entry))
      directories.set(absolute, { path: absolute, source } as AdditionalWorkingDirectory)
    }
  }
  const synced = syncPermissionRulesFromDisk(
    context,
    loadAllPermissionRulesFromDisk(),
  )
  return { ...synced, additionalWorkingDirectories: directories }
}
