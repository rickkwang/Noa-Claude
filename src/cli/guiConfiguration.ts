import { createHash } from 'node:crypto'
import { getCurrentProjectConfig, getGlobalConfig } from '../utils/config.js'
import { getSettingsForSource, getSettingsFilePathForSource, updateSettingsForSource } from '../utils/settings/settings.js'
import { addMcpConfig, removeMcpConfig, getProjectMcpConfigsFromCwd, doesEnterpriseMcpConfigExist } from '../services/mcp/config.js'
import { settingsChangeDetector } from '../utils/settings/changeDetector.js'
import { validatePermissionRule } from '../utils/settings/permissionValidation.js'

type Scope = 'user' | 'project' | 'local'
const sources = { user: 'userSettings', project: 'projectSettings', local: 'localSettings' } as const
const revision = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

function mcpConfigs(scope: Scope): Record<string, unknown> {
  if (scope === 'user') return getGlobalConfig().mcpServers ?? {}
  if (scope === 'local') return getCurrentProjectConfig().mcpServers ?? {}
  const result = getProjectMcpConfigsFromCwd(false)
  if (result.errors.length) throw new Error(result.errors.map(error => error.message).join('\n'))
  return Object.fromEntries(Object.entries(result.servers).map(([name, { scope: _, sourceDir: _sourceDir, ...config }]) => [name, config]))
}

export async function guiConfiguration(request: {
  kind: 'permissions' | 'mcp'; scope: Scope; action: 'get' | 'save' | 'remove'; revision?: string; name?: string; value?: Record<string, unknown>
}) {
  const { kind, scope, action } = request
  const source = sources[scope]
  const current = kind === 'permissions' ? getSettingsForSource(source)?.permissions ?? {} : mcpConfigs(scope)
  if (action !== 'get') {
    if (revision(current) !== request.revision) throw new Error('Configuration changed outside this editor. Reload before saving.')
    if (kind === 'permissions') {
      if (action !== 'save' || !request.value) throw new Error('Missing permission rules.')
      const rules: Record<string, string[]> = {}
      for (const key of ['allow', 'ask', 'deny']) {
        const value = request.value[key]
        if (!Array.isArray(value) || !value.every(rule => typeof rule === 'string' && rule.trim() && !rule.includes('\n'))) throw new Error(`Invalid ${key} rules.`)
        for (const rule of value as string[]) {
          const check = validatePermissionRule(rule)
          if (!check.valid) throw new Error(`Invalid ${key} rule "${rule}": ${check.error}`)
        }
        rules[key] = [...new Set(value as string[])]
      }
      const result = updateSettingsForSource(source, settings => {
        if (revision(settings.permissions ?? {}) !== request.revision) throw new Error('Configuration changed outside this editor. Reload before saving.')
        return { permissions: { ...settings.permissions, ...rules } }
      })
      if (result.error) throw result.error
      settingsChangeDetector.notifyChange(source)
    } else {
      if (doesEnterpriseMcpConfigExist()) throw new Error('MCP servers are managed by your organization.')
      if (!request.name || !/^[A-Za-z0-9_-]+$/.test(request.name)) throw new Error('Use letters, numbers, hyphens or underscores for the server name.')
      const checkRevision = (servers: Record<string, unknown>) => {
        if (revision(servers) !== request.revision) throw new Error('Configuration changed outside this editor. Reload before saving.')
      }
      if (action === 'remove') await removeMcpConfig(request.name, scope, checkRevision)
      else await addMcpConfig(request.name, request.value, scope, true, checkRevision)
    }
  }
  const value = kind === 'permissions' ? getSettingsForSource(source)?.permissions ?? {} : mcpConfigs(scope)
  return { value, revision: revision(value), path: kind === 'permissions' ? getSettingsFilePathForSource(source) : undefined, requiresReconnect: kind === 'mcp' && action !== 'get' }
}
