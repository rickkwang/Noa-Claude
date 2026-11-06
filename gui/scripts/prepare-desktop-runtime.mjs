// Stages the files a packaged desktop app needs at runtime, under gui/release-runtime/.
// electron-builder copies that folder into the app's Resources. Layout mirrors the repo
// so the bridge's relative imports (../../src, ../../run-noa.js) resolve unchanged.
import { cpSync, existsSync, mkdirSync, rmSync, copyFileSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

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

// Repo runtime: the CLI sources, its bundled entry, and production dependencies only.
// tsconfig.json carries the baseUrl that lets src/ files import 'src/...' (e.g. sessionStorage.ts).
for (const file of ["package.json", "bun.lock", "bunfig.toml", "tsconfig.json", "run-noa.js", "launcher-config.js"]) {
  copyFileSync(join(repo, file), join(runtimeRepo, file))
}
copyFiltered(join(repo, "src"), join(runtimeRepo, "src"))
copyFiltered(join(repo, "vendor"), join(runtimeRepo, "vendor"))
mkdirSync(join(runtimeRepo, "dist"), { recursive: true })
for (const file of readdirSync(join(repo, "dist")).filter((name) => name === "main.js" || name === "main.js.meta.json")) {
  copyFileSync(join(repo, "dist", file), join(runtimeRepo, "dist", file))
}
const install = spawnSync(bunPath(), ["install", "--production", "--frozen-lockfile", "--ignore-scripts"], { cwd: runtimeRepo, stdio: "inherit" })
if (install.status !== 0) fail("production install of the repo runtime failed")

// Bridge: server sources and the built UI. Its one npm import (diff) resolves from the repo runtime's node_modules.
const runtimeGui = join(runtimeRepo, "gui")
mkdirSync(runtimeGui, { recursive: true })
copyFiltered(join(gui, "server"), join(runtimeGui, "server"))
copyFiltered(join(gui, "dist"), join(runtimeGui, "dist"))
copyFileSync(join(gui, "package.json"), join(runtimeGui, "package.json"))

// Bun runs the bridge and each CLI session, so ship the same binary the developer uses.
const bunDir = join(staging, "bun")
mkdirSync(bunDir, { recursive: true })
copyFileSync(bunPath(), join(bunDir, "bun"))

function sizeOf(path) {
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    total += entry.isDirectory() ? sizeOf(full) : statSync(full).size
  }
  return total
}
console.log(`staged ${(sizeOf(staging) / 1024 / 1024).toFixed(1)} MiB at ${staging}`)
