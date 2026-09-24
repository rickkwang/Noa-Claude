/**
 * Paths whose resolution can reach the network before the user has approved
 * anything, so callers must decide on them from the string alone (no stat,
 * realpath, exists, …).
 */

/** UNC paths (`\\server\share`, `//server/share`): on Windows any filesystem
 * call triggers SMB/WebDAV resolution and can leak NTLM credentials. */
export function isUncPath(path: string): boolean {
  return path.startsWith('\\\\') || path.startsWith('//')
}

const KERNEL_REDIRECT_SEGMENT_RE = /^\.(?:vol|file|nofollow|resolve)$/i

/**
 * macOS `/.vol/<fsid>/<id>`, `/.file/id=…`, `/.nofollow/…`, `/.resolve/<flags>/…`:
 * prefixes the kernel redirects, which can address any mounted volume —
 * including a network mount — without the mount's visible path appearing in
 * the string. Judged on the lexically normalized path so `/tmp/../.vol/x` and
 * `/./.vol/x` are caught; case-insensitive because the default APFS volume is.
 */
export function isKernelRedirectedPath(path: string): boolean {
  if (!/\/\.(?:vol|file|nofollow|resolve)(?:\/|$)/i.test(path)) return false
  if (!path.startsWith('/')) return false
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
    if (segments.length === 1 && KERNEL_REDIRECT_SEGMENT_RE.test(segment)) {
      return true
    }
  }
  return false
}

export function isNetworkPath(path: string): boolean {
  return isUncPath(path) || isKernelRedirectedPath(path)
}
