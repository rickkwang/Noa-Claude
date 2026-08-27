import { gt, gte } from 'src/utils/semver.js'

const NOA_GITHUB_REPO = 'rickkwang/Noa-Claude'
const RELEASES_PER_PAGE = 100
const NOA_GITHUB_RELEASES_API_URL = `https://api.github.com/repos/${NOA_GITHUB_REPO}/releases`

const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/

type ReleaseEntry = {
  tag_name?: unknown
  draft?: unknown
  prerelease?: unknown
}

export function stripTagPrefix(tag: string): string {
  return tag.replace(/^v/, '')
}

export function hasExplicitInstallSource(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    env.NOA_INSTALL_REF ||
      env.NOA_INSTALL_REPO_TARBALL_URL ||
      env.NOA_INSTALL_SOURCE_DIR,
  )
}

export function isCurrentVersionAtLeast(
  currentVersion: string,
  latestTag: string,
): boolean | null {
  try {
    return gte(currentVersion, stripTagPrefix(latestTag))
  } catch {
    return null
  }
}

function isReleaseTag(name: unknown): name is string {
  return typeof name === 'string' && RELEASE_TAG_PATTERN.test(name)
}

function parseReleaseTagNames(payload: unknown): string[] {
  if (!Array.isArray(payload)) return []
  const names: string[] = []
  for (const entry of payload as (ReleaseEntry | null)[]) {
    if (entry?.draft === true || entry?.prerelease === true) continue
    const name = entry?.tag_name
    if (isReleaseTag(name)) names.push(name)
  }
  return names
}

export function parseLatestTagName(payload: unknown): string | null {
  let best: string | null = null
  for (const tag of parseReleaseTagNames(payload)) {
    if (best === null || gt(stripTagPrefix(tag), stripTagPrefix(best))) {
      best = tag
    }
  }
  return best
}

export async function fetchLatestReleaseTag(
  timeoutMs = 10_000,
): Promise<string | null> {
  try {
    const signal = AbortSignal.timeout(timeoutMs)
    const releases: ReleaseEntry[] = []

    for (let page = 1; ; page += 1) {
      const url = `${NOA_GITHUB_RELEASES_API_URL}?per_page=${RELEASES_PER_PAGE}&page=${page}`
      const res = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'noa-claude-updater',
        },
        signal,
      })
      if (!res.ok) return null

      const payload: unknown = await res.json()
      if (!Array.isArray(payload)) return null
      releases.push(...(payload as ReleaseEntry[]))
      if (payload.length < RELEASES_PER_PAGE) break
    }

    return parseLatestTagName(releases)
  } catch {
    return null
  }
}
