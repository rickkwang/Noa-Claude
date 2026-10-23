import { realpathSync } from 'fs'
import { homedir } from 'os'
import { resolve } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { getGlobalConfig, getProjectTrustKey } from '../config.js'
import { getProjectSettingsRelativePathCandidates } from '../productPaths.js'
import { getSettingsForSource, parseSettingsFile } from '../settings/settings.js'
import {
  type SettingSource,
  getEnabledSettingSources,
} from '../settings/constants.js'
import type { SettingsJson } from '../settings/types.js'

/**
 * Project and local settings grant permission rules and additional directories
 * only once the workspace is trusted explicitly. Trust inherited from a parent
 * directory does not unlock them.
 */

const PROJECT_SOURCES: SettingSource[] = ['projectSettings', 'localSettings']

/** Control and bidi characters: a path or rule containing them is not echoed as-is. */
export const UNSAFE_DISPLAY =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/

function realOrResolved(path: string): string {
  try {
    return realpathSync(path).normalize('NFC')
  } catch {
    return resolve(path)
  }
}

function isHomeWorkspace(): boolean {
  return realOrResolved(getOriginalCwd()) === realOrResolved(homedir())
}

function hasExplicitProjectTrust(): boolean {
  if (isHomeWorkspace()) return false
  return (
    getGlobalConfig().projects?.[getProjectTrustKey(getOriginalCwd())]
      ?.hasTrustDialogAccepted === true
  )
}

/** Whether a source's permission rules and directories are withheld right now. */
export function isProjectGrantSourceGated(source: SettingSource): boolean {
  if (!PROJECT_SOURCES.includes(source)) return false
  return !isHomeWorkspace() && !hasExplicitProjectTrust()
}

/** Gated project grants exist: /cd must tell the model they are not applied. */
export function hasGatedProjectGrants(): boolean {
  if (isHomeWorkspace() || hasExplicitProjectTrust()) return false
  return PROJECT_SOURCES.some(source =>
    settingsHaveGrants(getSettingsForSource(source)),
  )
}

function settingsHaveGrants(settings: SettingsJson | null): boolean {
  return (
    (settings?.permissions?.allow?.length ?? 0) > 0 ||
    (settings?.permissions?.additionalDirectories?.length ?? 0) > 0
  )
}

/** Project settings files Noa reads for a directory, in the project's own layout. */
export function projectSettingsFilesFor(directory: string): {
  path: string
  file: string
  source: SettingSource
}[] {
  const settingsFile = getProjectSettingsRelativePathCandidates('settings.json')[0]!
  const localFile = getProjectSettingsRelativePathCandidates('settings.local.json')[0]!
  return [
    { path: resolve(directory, settingsFile), file: settingsFile, source: 'projectSettings' },
    { path: resolve(directory, localFile), file: localFile, source: 'localSettings' },
  ]
}

function ruleText(rule: string): string {
  const text = rule.replace(new RegExp(UNSAFE_DISPLAY.source, 'g'), '').trim()
  return text.length > 60 ? `${text.slice(0, 59)}…` : text
}

/**
 * Lines for the trust prompt: what the target's project settings declare.
 * Trust-through-parent prompts list only grants; full prompts also list hooks
 * and command helpers.
 */
export function describeProjectDisclosures(
  directory: string,
  backstop: boolean,
): string[] {
  const lines: string[] = []
  for (const { path, file } of projectSettingsFilesFor(directory)) {
    const settings = parseSettingsFile(path).settings
    if (!settings) continue
    const allow = settings.permissions?.allow ?? []
    const dirs = settings.permissions?.additionalDirectories ?? []
    if (allow.length > 0) {
      const sample = allow.slice(0, 3).map(ruleText).join(', ')
      lines.push(`${file}: ${allow.length} permission rule(s), e.g. ${sample}`)
    }
    if (dirs.length > 0) {
      lines.push(`${file}: ${dirs.length} additional director${dirs.length === 1 ? 'y' : 'ies'}`)
    }
    if (backstop) continue
    const hooks = []
    if (
      settings.statusLine ||
      settings.fileSuggestion ||
      settings.subagentStatusLine ||
      Object.values(settings.hooks ?? {}).some(entries => entries.length > 0)
    ) {
      hooks.push('hooks')
    }
    const helpers = [
      settings.apiKeyHelper && 'apiKeyHelper',
      (settings.awsAuthRefresh || settings.awsCredentialExport) &&
        'AWS credential helper',
      settings.gcpAuthRefresh && 'gcpAuthRefresh',
      settings.otelHeadersHelper && 'otelHeadersHelper',
      settings.proxyAuthHelper && 'proxyAuthHelper',
    ].filter(Boolean)
    if (hooks.length > 0) lines.push(`${file}: ${hooks.join(', ')}`)
    if (helpers.length > 0) lines.push(`${file}: ${helpers.join(', ')}`)
  }
  return lines
}

/** Additional directories from every enabled source except gated project grants. */
export function grantedAdditionalDirectories(): string[] {
  return getEnabledSettingSources().flatMap(source =>
    isProjectGrantSourceGated(source)
      ? []
      : (getSettingsForSource(source)?.permissions?.additionalDirectories ?? []),
  )
}
