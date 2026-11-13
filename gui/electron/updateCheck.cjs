// Checks GitHub Releases for a newer desktop build. It only reports the release; installing it is
// macUpdateInstaller.cjs's job. Desktop releases are tagged
// gui-v<version>, which the CLI installer ignores (it accepts only vX.Y.Z tags).
const http = require('http')
const https = require('https')

const RELEASES_URL = 'https://api.github.com/repos/rickkwang/Noa-Claude/releases?per_page=50'
const TAG_PREFIX = 'gui-v'
const TIMEOUT_MS = 10000

function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(text ?? ''))
  return match ? match.slice(1).map(Number) : null
}

function isNewer(candidate, current) {
  for (let i = 0; i < 3; i += 1) {
    if (candidate[i] !== current[i]) return candidate[i] > current[i]
  }
  return false
}

// Picks the newest published, non-draft, non-prerelease gui-v release.
function pickLatest(releases) {
  let best = null
  for (const release of Array.isArray(releases) ? releases : []) {
    if (release?.draft || release?.prerelease) continue
    const tag = String(release?.tag_name ?? '')
    if (!tag.startsWith(TAG_PREFIX)) continue
    const version = parseVersion(tag.slice(TAG_PREFIX.length))
    if (!version) continue
    if (!best || isNewer(version, best.version)) best = { version, release }
  }
  if (!best) return null
  const assets = best.release.assets ?? []
  const dmg = assets.find((item) => /arm64\.dmg$/.test(item?.name ?? ''))
  const version = best.version.join('.')
  return {
    version,
    url: dmg?.browser_download_url ?? best.release.html_url,
    // electron-updater reads latest-mac.yml from the folder that holds this release's assets.
    feedUrl: dmg?.browser_download_url ? new URL('.', dmg.browser_download_url).href : `https://github.com/rickkwang/Noa-Claude/releases/tag/${TAG_PREFIX}${version}`,
    notes: best.release.html_url,
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    // NOA_UPDATE_FEED may point at a local http:// server for testing; the default feed is https.
    const client = url.startsWith('https:') ? https : http
    const request = client.get(url, { headers: { 'User-Agent': 'Noa-Agent', Accept: 'application/vnd.github+json' } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`Update check failed: HTTP ${response.statusCode}`))
        return
      }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch {
          reject(new Error('Update check failed: invalid response'))
        }
      })
    })
    request.setTimeout(TIMEOUT_MS, () => request.destroy(new Error('Update check timed out')))
    request.on('error', reject)
  })
}

// Resolves to { version, url, notes } when a newer build exists, otherwise null.
async function checkForUpdate(currentVersion, feedUrl = process.env.NOA_UPDATE_FEED || RELEASES_URL) {
  const current = parseVersion(currentVersion)
  if (!current) throw new Error(`Unrecognized app version: ${currentVersion}`)
  const latest = pickLatest(await fetchJson(feedUrl))
  if (!latest) return null
  return isNewer(parseVersion(latest.version), current) ? latest : null
}

module.exports = { checkForUpdate, pickLatest, isNewer, parseVersion }
