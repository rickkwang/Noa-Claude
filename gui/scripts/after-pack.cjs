// electron-builder's extraResources skips node_modules, which the repo runtime needs at run time.
// Copy the staged runtime in directly, before electron-builder signs the bundle.
const fs = require('fs')
const path = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const productFile = `${context.packager.appInfo.productFilename}.app`
  const resources = path.join(context.appOutDir, productFile, 'Contents', 'Resources')
  const staged = path.join(__dirname, '..', 'release-runtime', 'repo')
  if (!fs.existsSync(path.join(staged, 'node_modules'))) throw new Error(`staged runtime has no node_modules: ${staged}`)
  fs.cpSync(staged, path.join(resources, 'repo'), { recursive: true, dereference: true })
}
