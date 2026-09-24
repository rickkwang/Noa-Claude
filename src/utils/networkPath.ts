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

/**
 * Walk an absolute POSIX path's segments with `.`/`..` applied lexically,
 * calling `stop` after each push; returns true as soon as it does. Deciding
 * mid-walk is deliberate: the kernel looks up each prefix before it can apply
 * a later `..`, so `/net/host/..` has already triggered the mount.
 */
function someNormalizedPrefix(
  path: string,
  stop: (segments: string[]) => boolean,
): boolean {
  if (!path.startsWith('/')) return false
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
    if (stop(segments)) return true
  }
  return false
}

/** Lowercased, with zero-width and bidi-control characters removed, so
 * `/N\u200bet/host` can't pass for something other than /net. */
function foldSegment(segment: string): string {
  return segment
    .replace(/[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g, '')
    .toLowerCase()
}

/**
 * The autofs -hosts map: `/net/<host>/…` (macOS and Linux) and
 * `/Network/Servers/<host>/…` (macOS). Looking up `<host>` is itself a DNS
 * query followed by an NFS mount.
 */
export function isAutomountHostsPath(path: string): boolean {
  return someNormalizedPrefix(
    path,
    segments =>
      (segments.length === 2 && foldSegment(segments[0]!) === 'net') ||
      (segments.length === 3 &&
        foldSegment(segments[0]!) === 'network' &&
        foldSegment(segments[1]!) === 'servers'),
  )
}

/** `/net` itself: listing it can enumerate hosts through the automounter. */
export function isAutomountNetRoot(path: string): boolean {
  if (!path.startsWith('/')) return false
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments.length === 1 && foldSegment(segments[0]!) === 'net'
}

/** Anything under macOS `/Network`: the automounter's browse surface, which
 * can trigger directory-service lookups and mounts. */
export function isAutomountBrowsePath(path: string): boolean {
  return someNormalizedPrefix(
    path,
    segments => segments.length === 1 && foldSegment(segments[0]!) === 'network',
  )
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
  return someNormalizedPrefix(
    path,
    segments =>
      segments.length === 1 && KERNEL_REDIRECT_SEGMENT_RE.test(segments[0]!),
  )
}

/** Any path whose lookup alone can reach the network. */
export function isNetworkPath(path: string): boolean {
  return (
    isUncPath(path) ||
    isAutomountHostsPath(path) ||
    isAutomountBrowsePath(path) ||
    isKernelRedirectedPath(path)
  )
}
