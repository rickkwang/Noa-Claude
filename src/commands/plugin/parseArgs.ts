// @ts-nocheck
// Parse plugin subcommand arguments into structured commands
export type ParsedCommand =
  | { type: 'menu' }
  | { type: 'help' }
  | { type: 'install'; marketplace?: string; plugin?: string }
  | { type: 'manage' }
  | { type: 'uninstall'; plugin?: string }
  | { type: 'enable'; plugin?: string }
  | { type: 'disable'; plugin?: string }
  | { type: 'validate'; path?: string }
  | {
      type: 'marketplace'
      action?: 'add' | 'remove' | 'update' | 'list'
      target?: string
      /** `marketplace add --scope`: settings source to record the marketplace in */
      scope?: 'user' | 'project' | 'local'
      /** `marketplace add --sparse`: git sparse-checkout paths (github/git sources only) */
      sparsePaths?: string[]
      /** Flags CC accepts but Noa has no backend for — rejected with a
       *  clear error instead of being swallowed into the target path */
      unsupportedFlags?: string[]
    }

export function parsePluginArgs(args?: string): ParsedCommand {
  if (!args) {
    return { type: 'menu' }
  }

  const parts = args.trim().split(/\s+/)
  const command = parts[0]?.toLowerCase()

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      return { type: 'help' }

    case 'install':
    case 'i': {
      const target = parts[1]
      if (!target) {
        return { type: 'install' }
      }

      // Check if it's in format plugin@marketplace
      if (target.includes('@')) {
        const [plugin, marketplace] = target.split('@')
        return { type: 'install', plugin, marketplace }
      }

      // Check if the target looks like a marketplace (URL or path)
      const isMarketplace =
        target.startsWith('http://') ||
        target.startsWith('https://') ||
        target.startsWith('file://') ||
        target.includes('/') ||
        target.includes('\\')

      if (isMarketplace) {
        // This is a marketplace URL/path, no plugin specified
        return { type: 'install', marketplace: target }
      }

      // Otherwise treat it as a plugin name
      return { type: 'install', plugin: target }
    }

    case 'manage':
      return { type: 'manage' }

    case 'uninstall':
      return { type: 'uninstall', plugin: parts[1] }

    case 'enable':
      return { type: 'enable', plugin: parts[1] }

    case 'disable':
      return { type: 'disable', plugin: parts[1] }

    case 'validate': {
      const target = parts.slice(1).join(' ').trim()
      return { type: 'validate', path: target || undefined }
    }

    case 'marketplace':
    case 'market': {
      const action = parts[1]?.toLowerCase()

      switch (action) {
        case 'add': {
          // Split flags from the positional source. `--scope` and `--sparse`
          // match the headless CLI (`plugin marketplace add`); --console and
          // --claudeai parse cleanly but are rejected later (Noa has no
          // claude.ai-hosted marketplace backend or console flow).
          let scope: 'user' | 'project' | 'local' | undefined
          let sparsePaths: string[] | undefined
          const unsupportedFlags: string[] = []
          const positional: string[] = []
          const rest = parts.slice(2)
          for (let i = 0; i < rest.length; i++) {
            const part = rest[i]!
            if (part === '--scope') {
              const value = rest[++i]
              if (value === 'user' || value === 'project' || value === 'local') {
                scope = value
              } else {
                return {
                  type: 'marketplace',
                  action: 'add',
                  unsupportedFlags: [
                    `Invalid --scope "${value ?? ''}" (expected user, project, or local)`,
                  ],
                }
              }
            } else if (part === '--sparse') {
              // Variadic like the CLI's `--sparse <paths...>`: consume until
              // the next flag
              sparsePaths = sparsePaths ?? []
              while (i + 1 < rest.length && !rest[i + 1]!.startsWith('--')) {
                sparsePaths.push(rest[++i]!)
              }
              if (sparsePaths.length === 0) {
                return {
                  type: 'marketplace',
                  action: 'add',
                  unsupportedFlags: ['--sparse requires at least one path'],
                }
              }
            } else if (part === '--console' || part === '--claudeai') {
              unsupportedFlags.push(part)
            } else {
              positional.push(part)
            }
          }
          return {
            type: 'marketplace',
            action: 'add',
            target: positional.join(' ') || undefined,
            scope,
            sparsePaths,
            unsupportedFlags: unsupportedFlags.length > 0 ? unsupportedFlags : undefined,
          }
        }
        case 'remove':
        case 'rm':
          return { type: 'marketplace', action: 'remove', target: parts.slice(2).join(' ') }
        case 'update':
          return { type: 'marketplace', action: 'update', target: parts.slice(2).join(' ') }
        case 'list':
          return { type: 'marketplace', action: 'list' }
        default:
          // No action specified, show marketplace menu
          return { type: 'marketplace' }
      }
    }

    default:
      // Unknown command, show menu
      return { type: 'menu' }
  }
}
