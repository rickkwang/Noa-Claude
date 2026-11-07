// Signs the app with a fixed self-signed identity when the build machine has one.
// An ad-hoc signature changes with every build, so macOS treats each update as a new app and
// forgets the privacy permissions granted to the previous one. A fixed certificate keeps the
// designated requirement (bundle id + certificate) identical across releases.
// electron-builder only discovers trusted identities, so this hook looks the certificate up itself.
// Only CI, whose builds are never published, may fall back to an ad-hoc signature.
const { execFileSync } = require('child_process')
const { createRequire } = require('module')

// @electron/osx-sign is electron-builder's own signer; resolve it through electron-builder, which
// declares it, rather than relying on it being hoisted.
const fromBuilder = createRequire(require.resolve('app-builder-lib/package.json', { paths: [require.resolve('electron-builder/package.json')] }))
const { signAsync } = fromBuilder('@electron/osx-sign')

const IDENTITY_NAME = 'Noa Agent Self-Signed'

function findIdentityHash(name) {
  try {
    const out = execFileSync('/usr/bin/security', ['find-identity', '-p', 'codesigning'], { encoding: 'utf8' })
    const line = out.split('\n').find(it => it.includes(`"${name}"`))
    return line?.match(/\b([0-9A-F]{40})\b/)?.[1]
  } catch {
    return undefined
  }
}

exports.default = async function sign(opts) {
  const hash = findIdentityHash(IDENTITY_NAME)
  if (!hash && !process.env.CI) {
    // An ad-hoc release would make every user grant the app's permissions again.
    throw new Error(`No "${IDENTITY_NAME}" code-signing identity in the keychain. Import it before building a release.`)
  }
  if (!hash) console.warn(`  • no "${IDENTITY_NAME}" signing identity, falling back to ad-hoc on CI`)
  else console.log(`  • signing with "${IDENTITY_NAME}" (${hash})`)
  await signAsync({ ...opts, identity: hash || '-', identityValidation: false })
}
