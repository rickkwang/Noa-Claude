// Stages the files a packaged desktop app needs at runtime, under gui/release-runtime/.
// electron-builder copies that folder into the app's Resources. Layout mirrors the repo
// so the bridge's relative paths (../../src, ../../run-noa.js) resolve unchanged.
import { cpSync, existsSync, mkdirSync, rmSync, copyFileSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"

const gui = resolve(import.meta.dir, "..")
const repo = resolve(gui, "..")
const staging = join(gui, "release-runtime")
const runtimeRepo = join(staging, "repo")

function fail(message) {
  console.error(`prepare-desktop-runtime: ${message}`)
  process.exit(1)
}

function bunPath() {
  const candidates = [process.env.BUN_PATH, join(homedir(), ".bun", "bin", "bun"), "/opt/homebrew/bin/bun", "/usr/local/bin/bun"]
  const found = candidates.find((path) => path && existsSync(path))
  if (!found) fail("bun not found; set BUN_PATH")
  return found
}

function copyFiltered(from, to) {
  cpSync(from, to, {
    recursive: true,
    filter: (source) => !/(^|\/)(test|tests|__tests__)(\/|$)/.test(source.slice(from.length)) && !/\.test\.ts$/.test(source),
  })
}

rmSync(staging, { recursive: true, force: true })
mkdirSync(runtimeRepo, { recursive: true })

if (!existsSync(join(repo, "dist", "main.js"))) fail("dist/main.js is missing; run `bun run build` in the repo root first")
if (!existsSync(join(gui, "dist", "index.html"))) fail("gui/dist is missing; run `bun run build` in gui/ first")

// Repo runtime: the bundled CLI and only what it still loads at run time. Every file in the app is
// scanned by macOS on the first launch of each update, so the sources and the full dependency tree
// stay out: the bundle already contains them.
for (const file of ["package.json", "bun.lock", "run-noa.js", "launcher-config.js"]) {
  copyFileSync(join(repo, file), join(runtimeRepo, file))
}
// launcher-config.js imports this one source file.
mkdirSync(join(runtimeRepo, "src", "constants"), { recursive: true })
copyFileSync(join(repo, "src", "constants", "oauthConfigPath.js"), join(runtimeRepo, "src", "constants", "oauthConfigPath.js"))
copyFiltered(join(repo, "vendor"), join(runtimeRepo, "vendor"))
mkdirSync(join(runtimeRepo, "dist"), { recursive: true })
for (const file of readdirSync(join(repo, "dist")).filter((name) => name === "main.js" || name === "main.js.meta.json")) {
  copyFileSync(join(repo, "dist", file), join(runtimeRepo, "dist", file))
}
const install = spawnSync(bunPath(), ["install", "--production", "--frozen-lockfile", "--ignore-scripts"], { cwd: runtimeRepo, stdio: "inherit" })
if (install.status !== 0) fail("production install of the repo runtime failed")

// Packages dist/main.js imports at run time instead of bundling: the build's externals (native
// modules). ws and node-fetch are built into Bun. Everything else in node_modules is removed.
const RUNTIME_PACKAGES = ["sharp", "audio-capture-napi", "modifiers-napi", "url-handler-napi"]
// The bundle replaces sandbox-runtime with a stub and only reads its package.json for the version
// that diagnostics report, so keep that one file.
const SANDBOX_MANIFEST = join(runtimeRepo, "node_modules", "@anthropic-ai", "sandbox-runtime", "package.json")
if (!existsSync(SANDBOX_MANIFEST)) fail("@anthropic-ai/sandbox-runtime is not installed")
const sandboxManifest = readFileSync(SANDBOX_MANIFEST)
function packageDir(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name)
    if (existsSync(join(candidate, "package.json"))) return candidate
    if (dir === runtimeRepo || dirname(dir) === dir) return null
  }
}
const keep = new Set()
function keepPackage(name, from) {
  const dir = packageDir(name, from)
  if (!dir || keep.has(dir)) return
  keep.add(dir)
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
  for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) keepPackage(dependency, dir)
}
for (const name of RUNTIME_PACKAGES) {
  if (!packageDir(name, runtimeRepo)) fail(`runtime package ${name} is not installed`)
  keepPackage(name, runtimeRepo)
}
function prune(nodeModules) {
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    const full = join(nodeModules, entry.name)
    if (entry.name === ".bin") { rmSync(full, { recursive: true, force: true }); continue }
    const packages = entry.name.startsWith("@") ? readdirSync(full).map((name) => join(full, name)) : [full]
    for (const dir of packages) {
      if (!keep.has(dir)) { rmSync(dir, { recursive: true, force: true }); continue }
      if (existsSync(join(dir, "node_modules"))) prune(join(dir, "node_modules"))
    }
    if (entry.name.startsWith("@") && readdirSync(full).length === 0) rmSync(full, { recursive: true })
  }
}
prune(join(runtimeRepo, "node_modules"))
mkdirSync(dirname(SANDBOX_MANIFEST), { recursive: true })
writeFileSync(SANDBOX_MANIFEST, sandboxManifest)

// Bridge: one bundled server file and the built UI, at the paths electron/main.cjs and the bridge expect.
const runtimeGui = join(runtimeRepo, "gui")
mkdirSync(runtimeGui, { recursive: true })
async function bundle(options) {
  const result = await Bun.build({ target: "bun", format: "esm", loader: { ".md": "text" }, ...options })
  if (!result.success) fail(`bundling failed:\n${result.logs.map(String).join("\n")}`)
}
await bundle({ entrypoints: [join(gui, "server", "main.ts")], outdir: join(runtimeGui, "server") })
// server/stats.ts loads these CLI modules by path at run time, so bundle them where it looks.
await bundle({
  entrypoints: ["stats.ts", "format.ts", "model/model.ts"].map((file) => join(repo, "src", "utils", file)),
  root: join(repo, "src", "utils"),
  outdir: join(runtimeRepo, "src", "utils"),
  splitting: true,
})
copyFiltered(join(gui, "dist"), join(runtimeGui, "dist"))
copyFileSync(join(gui, "package.json"), join(runtimeGui, "package.json"))

// Bun runs the bridge and each CLI session, so ship the same binary the developer uses.
const bunDir = join(staging, "bun")
mkdirSync(bunDir, { recursive: true })
copyFileSync(bunPath(), join(bunDir, "bun"))

// ripgrep: file search runs `rg` from PATH, and Electron puts this directory first (electron/main.cjs),
// so the app never depends on a Homebrew install. Pinned to the version CI uses, checked against its SHA-256.
const RG_VERSION = "14.1.1"
const RG_NAME = `ripgrep-${RG_VERSION}-aarch64-apple-darwin`
const RG_SHA256 = "24ad76777745fbff131c8fbc466742b011f925bfa4fffa2ded6def23b5b937be"
const rgDir = join(staging, "rg")
mkdirSync(rgDir, { recursive: true })
const rgArchive = join(staging, `${RG_NAME}.tar.gz`)
const download = spawnSync("curl", ["-fsSL", "--retry", "3", "-o", rgArchive, `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/${RG_NAME}.tar.gz`], { stdio: "inherit" })
if (download.status !== 0) fail("downloading ripgrep failed")
const digest = createHash("sha256").update(readFileSync(rgArchive)).digest("hex")
if (digest !== RG_SHA256) fail(`ripgrep checksum mismatch: ${digest}`)
const extract = spawnSync("tar", ["-xzf", rgArchive, "-C", staging, `${RG_NAME}/rg`], { stdio: "inherit" })
if (extract.status !== 0) fail("extracting ripgrep failed")
copyFileSync(join(staging, RG_NAME, "rg"), join(rgDir, "rg"))
rmSync(join(staging, RG_NAME), { recursive: true, force: true })
rmSync(rgArchive, { force: true })

function sizeOf(path) {
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    total += entry.isDirectory() ? sizeOf(full) : statSync(full).size
  }
  return total
}
console.log(`staged ${(sizeOf(staging) / 1024 / 1024).toFixed(1)} MiB at ${staging}`)
