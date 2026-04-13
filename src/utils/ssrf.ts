// @ts-nocheck
/**
 * Enhanced SSRF (Server-Side Request Forgery) protection utilities.
 *
 * This module provides comprehensive detection of local and private network addresses
 * to prevent SSRF attacks when making HTTP requests to user-provided URLs.
 *
 * Blocked address ranges:
 * - IPv4:
 *   - 0.0.0.0/8 (this network)
 *   - 10.0.0.0/8 (private)
 *   - 100.64.0.0/10 (shared address space / CGNAT)
 *   - 169.254.0.0/16 (link-local, cloud metadata)
 *   - 172.16.0.0/12 (private)
 *   - 192.168.0.0/16 (private)
 *
 * - IPv6:
 *   - :: (unspecified)
 *   - fc00::/7 (unique local)
 *   - fe80::/10 (link-local)
 *   - ::ffff:<v4> (IPv4-mapped IPv6 in blocked ranges)
 *
 * Allowed (not blocked):
 * - 127.0.0.0/8 (loopback)
 * - ::1 (loopback)
 * - Publicly routable addresses
 */

import { isIP } from 'net'

// Localhost hostnames that are allowed
const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

// .local domain suffix - typically indicates local network resources
const LOCAL_DOMAIN_SUFFIX = '.local'

/**
 * Check if a hostname is a localhost variant.
 */
function isLocalhostHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  return LOCALHOST_HOSTNAMES.has(lower)
}

/**
 * Check if a hostname ends with .local (bonjour/mDNS local network).
 */
function isLocalDomain(hostname: string): boolean {
  return hostname.toLowerCase().endsWith(LOCAL_DOMAIN_SUFFIX)
}

/**
 * Check if an IPv4 address is in a private range.
 *
 * Private IPv4 ranges:
 * - 10.0.0.0/8
 * - 172.16.0.0/12 (172.16 - 172.31)
 * - 192.168.0.0/16
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  const [a, b] = parts

  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) {
    return false
  }

  // 10.0.0.0/8
  if (a === 10) return true

  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true

  // 192.168.0.0/16
  if (a === 192 && b === 168) return true

  return false
}

/**
 * Check if an IPv6 address is in a private or link-local range.
 *
 * Private IPv6 ranges:
 * - fc00::/7 (unique local addresses: fc00:: through fdff::)
 * - fe80::/10 (link-local)
 */
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()

  // ::1 loopback is allowed
  if (lower === '::1') return false

  // :: unspecified
  if (lower === '::') return true

  // Check for IPv4-mapped IPv6 address (::ffff:x.x.x.x)
  const mappedV4 = extractMappedIPv4(lower)
  if (mappedV4 !== null) {
    return isPrivateIPv4(mappedV4) || isBlockedIPv4(mappedV4)
  }

  // fc00::/7 — unique local addresses
  if (lower.startsWith('fc') || lower.startsWith('fd')) {
    return true
  }

  // fe80::/10 — link-local
  const firstHextet = lower.split(':')[0]
  if (
    firstHextet &&
    firstHextet.length === 4 &&
    firstHextet >= 'fe80' &&
    firstHextet <= 'febf'
  ) {
    return true
  }

  return false
}

/**
 * Check if an IPv4 address is blocked (non-loopback private/link-local).
 * Differs from isPrivateIPv4 in that it also catches 0.0.0.0/8, 169.254.0.0/16,
 * and 100.64.0.0/10 which are not strictly "private" but are also not routable.
 */
function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  const [a, b] = parts

  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) {
    return false
  }

  // Loopback explicitly allowed
  if (a === 127) return false

  // 0.0.0.0/8 — "this" network
  if (a === 0) return true

  // 10.0.0.0/8 — private
  if (a === 10) return true

  // 169.254.0.0/16 — link-local, cloud metadata
  if (a === 169 && b === 254) return true

  // 172.16.0.0/12 — private
  if (a === 172 && b >= 16 && b <= 31) return true

  // 100.64.0.0/10 — shared address space (CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true

  // 192.168.0.0/16 — private
  if (a === 192 && b === 168) return true

  return false
}

/**
 * Expand an IPv6 address with :: to its full 8 hextet representation.
 * Returns null if expansion fails.
 */
function expandIPv6Groups(addr: string): number[] | null {
  // Handle trailing dotted-decimal IPv4 (e.g. ::ffff:169.254.169.254)
  let tailHextets: number[] = []
  if (addr.includes('.')) {
    const lastColon = addr.lastIndexOf(':')
    const v4 = addr.slice(lastColon + 1)
    addr = addr.slice(0, lastColon)
    const octets = v4.split('.').map(Number)
    if (
      octets.length !== 4 ||
      octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)
    ) {
      return null
    }
    tailHextets = [
      (octets[0]! << 8) | octets[1]!,
      (octets[2]! << 8) | octets[3]!,
    ]
  }

  // Expand :: (at most one) into the right number of zero groups
  const dbl = addr.indexOf('::')
  let head: string[]
  let tail: string[]
  if (dbl === -1) {
    head = addr.split(':')
    tail = []
  } else {
    const headStr = addr.slice(0, dbl)
    const tailStr = addr.slice(dbl + 2)
    head = headStr === '' ? [] : headStr.split(':')
    tail = tailStr === '' ? [] : tailStr.split(':')
  }

  const target = 8 - tailHextets.length
  const fill = target - head.length - tail.length
  if (fill < 0) return null

  const hex = [...head, ...new Array<string>(fill).fill('0'), ...tail]
  const nums = hex.map(h => parseInt(h, 16))
  if (nums.some(n => Number.isNaN(n) || n < 0 || n > 0xffff)) {
    return null
  }
  nums.push(...tailHextets)
  return nums.length === 8 ? nums : null
}

/**
 * Extract embedded IPv4 from an IPv4-mapped IPv6 address.
 * Returns null if not an IPv4-mapped address.
 */
function extractMappedIPv4(addr: string): string | null {
  const g = expandIPv6Groups(addr)
  if (!g) return null

  // IPv4-mapped: first 80 bits zero, next 16 bits ffff, last 32 bits = IPv4
  if (
    g[0] === 0 &&
    g[1] === 0 &&
    g[2] === 0 &&
    g[3] === 0 &&
    g[4] === 0 &&
    g[5] === 0xffff
  ) {
    const hi = g[6]!
    const lo = g[7]!
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
  }
  return null
}

/**
 * Check if a hostname or IP address is a blocked (private/link-local) address.
 */
function isBlockedAddress(address: string): boolean {
  const v = isIP(address)
  if (v === 4) {
    return isBlockedIPv4(address)
  }
  if (v === 6) {
    return isPrivateIPv6(address)
  }
  return false
}

/**
 * Strip IPv6 zone ID (e.g. %eth0) from an address.
 * Zone IDs are only valid on link-local addresses and should not be
 * part of network requests.
 */
function stripIPv6ZoneId(addr: string): string {
  const zoneIndex = addr.indexOf('%')
  return zoneIndex !== -1 ? addr.slice(0, zoneIndex) : addr
}

/**
 * Remove brackets from IPv6 addresses (used in URLs like http://[::1]:8080/).
 */
function stripIPv6Brackets(addr: string): string {
  if (addr.startsWith('[') && addr.endsWith(']')) {
    return addr.slice(1, -1)
  }
  return addr
}

/**
 * Determines if a URL points to a local or private network address.
 *
 * This function checks:
 * - Localhost hostnames (localhost, 127.0.0.1, ::1)
 * - Private IPv4 ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
 * - Link-local addresses (169.254.x.x, fe80::x)
 * - Cloud metadata addresses (169.254.169.254)
 * - Shared address space (100.64-127.x.x)
 * - IPv4-mapped IPv6 addresses that map to blocked ranges
 * - .local domain names (bonjour/mDNS)
 * - IPv6 zone IDs and brackets
 *
 * @param urlString - The URL string to check
 * @returns true if the URL points to a local or private network, false otherwise
 */
export function isLocalOrPrivateUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString)
    let hostname = parsed.hostname

    // Strip IPv6 brackets if present
    hostname = stripIPv6Brackets(hostname)

    // Strip IPv6 zone ID if present
    hostname = stripIPv6ZoneId(hostname)

    // Check for localhost hostname variants
    if (isLocalhostHostname(hostname)) {
      return true
    }

    // Check for .local domain (bonjour/mDNS local network)
    if (isLocalDomain(hostname)) {
      return true
    }

    // Check if it's an IP address
    const ipVersion = isIP(hostname)
    if (ipVersion !== 0) {
      return isBlockedAddress(hostname)
    }

    // For non-IP hostnames, we can't determine if they're private without DNS resolution.
    // Return false to allow the lookup to happen and let ssrfGuardedLookup validate the resolved IP.
    return false
  } catch {
    // Invalid URL - let the caller handle this
    return false
  }
}

/**
 * Validates that a URL does not point to a local or private network address.
 * Throws an error with a descriptive message if the URL is blocked.
 *
 * @param urlString - The URL string to validate
 * @throws Error if the URL points to a local or private network
 */
export function validateUrlNotLocalOrPrivate(urlString: string): void {
  if (isLocalOrPrivateUrl(urlString)) {
    throw new Error(
      `URL blocked: ${urlString} points to a local or private network address`,
    )
  }
}

/**
 * Check if an address is loopback (127.0.0.0/8 or ::1).
 * Unlike isBlockedAddress, loopback is allowed for local dev servers.
 */
export function isLoopbackAddress(address: string): boolean {
  const lower = address.toLowerCase()

  // Check for localhost hostname variants
  if (LOCALHOST_HOSTNAMES.has(lower)) {
    return true
  }

  // Check if IP
  const v = isIP(address)
  if (v === 4) {
    const parts = address.split('.').map(Number)
    return parts[0] === 127
  }
  if (v === 6) {
    return lower === '::1'
  }

  return false
}
