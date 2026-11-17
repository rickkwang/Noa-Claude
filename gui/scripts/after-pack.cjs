// electron-builder's extraResources skips node_modules, which the repo runtime needs at run time.
// Copy the staged runtime in directly, before electron-builder signs the bundle.
const fs = require('fs')
const path = require('path')

const KEEP_LPROJ = new Set(['en.lproj', 'en_GB.lproj', 'zh_CN.lproj', 'zh_TW.lproj'])

function pruneLocales(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.endsWith('.lproj') && !KEEP_LPROJ.has(entry.name)) {
      fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true })
    }
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const productFile = `${context.packager.appInfo.productFilename}.app`
  const contents = path.join(context.appOutDir, productFile, 'Contents')
  const resources = path.join(contents, 'Resources')
  const staged = path.join(__dirname, '..', 'release-runtime', 'repo')
  if (!fs.existsSync(path.join(staged, 'node_modules'))) throw new Error(`staged runtime has no node_modules: ${staged}`)
  fs.cpSync(staged, path.join(resources, 'repo'), { recursive: true, dereference: true })

  // Strip unused Chromium/Electron locale packs before signing to shrink the bundle.
  pruneLocales(resources)
  pruneLocales(path.join(contents, 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Resources'))
}
