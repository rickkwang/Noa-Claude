// @ts-nocheck
import { existsSync, readFileSync, realpathSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join, resolve, sep } from 'path'

/**
 * Canonical spelling of a path: symlinks in the existing part are resolved
 * (macOS /tmp is /private/tmp), the not-yet-created tail is kept as written.
 * install.sh's canonical_path() must agree with this.
 */
export function canonicalPath(path: string): string {
  let current = resolve(path)
  const tail: string[] = []
  while (!existsSync(current) && dirname(current) !== current) {
    tail.unshift(basename(current))
    current = dirname(current)
  }
  return join(realpathSync(current), ...tail)
}

export const NOA_CURL_INSTALL_COMMAND =
  'curl -fsSL https://raw.githubusercontent.com/rickkwang/Noa-Claude/master/install.sh | bash'

export function usesCurlInstallerBuild(): boolean {
  return MACRO.DISTRIBUTION === 'curl'
}

/**
 * The curl-installed copy this process runs from, or null when it is anything
 * else (a checkout, a dev build, an unrelated project). Callers may only delete
 * under the returned directory.
 */
export function getOwnInstallRoot(): string | null {
  const root = MACRO.INSTALL_ROOT
  if (!root || !usesCurlInstallerBuild()) return null
  const dir = canonicalPath(root)
  // Both sides canonical: HOME may be spelled through a symlink (macOS /tmp).
  // A root that is HOME, or contains HOME, must never be deleted.
  const home = canonicalPath(homedir())
  if (dir === '/' || home === dir || home.startsWith(dir + sep)) {
    return null
  }
  // install.sh copies the source without .git; a checkout keeps it.
  if (existsSync(join(dir, '.git'))) return null
  if (!existsSync(join(dir, 'bin', 'noa.js'))) return null
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    if (pkg.name !== MACRO.PACKAGE_URL) return null
  } catch {
    return null
  }
  return dir
}
