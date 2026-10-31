// Plugin marketplace endpoints. Everything runs through the CLI's own `plugin` subcommands at user scope,
// so the GUI and the terminal always agree on what is installed.
import { readFile } from "node:fs/promises"
import { join } from "node:path"

const TIMEOUT_MS = 120_000
// Marketplace and plugin names, and plugin@marketplace ids. A leading dash would be read as a CLI flag.
const NAME = /^[A-Za-z0-9][A-Za-z0-9._@-]*$/

const ACTIONS = {
  "marketplace-add": ["marketplace", "add"],
  "marketplace-remove": ["marketplace", "remove"],
  "marketplace-update": ["marketplace", "update"],
  install: ["install"],
  uninstall: ["uninstall"],
  enable: ["enable"],
  disable: ["disable"],
} as const

export type PluginAction = keyof typeof ACTIONS

async function runPlugin(root: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string; timedOut: boolean }> {
  const proc = Bun.spawn([process.execPath, join(root, "run-noa.js"), "plugin", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; proc.kill() }, TIMEOUT_MS)
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    return { ok: code === 0 && !timedOut, stdout, stderr, timedOut }
  } finally {
    clearTimeout(timer)
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// The CLI lists installed plugins without their description, so read it from the plugin's own manifest.
async function withManifest(plugin: unknown): Promise<unknown> {
  const installPath = (plugin as { installPath?: unknown }).installPath
  if (typeof installPath !== "string") return plugin
  try {
    const manifest = JSON.parse(await readFile(join(installPath, ".claude-plugin", "plugin.json"), "utf8")) as { description?: unknown; homepage?: unknown }
    return {
      ...(plugin as object),
      description: typeof manifest.description === "string" ? manifest.description : undefined,
      homepage: typeof manifest.homepage === "string" ? manifest.homepage : undefined,
    }
  } catch {
    return plugin
  }
}

function failure(result: { stderr: string; stdout: string; timedOut: boolean }): string {
  if (result.timedOut) return "The plugin command timed out."
  return (result.stderr || result.stdout).trim().split("\n").filter((line) => line.trim()).slice(-3).join("\n") || "Command failed."
}

// Throws when the CLI fails, so the page shows a retryable error instead of an empty catalog.
export async function listPlugins(root: string): Promise<{ marketplaces: unknown[]; installed: unknown[]; available: unknown[] }> {
  const [markets, plugins] = await Promise.all([
    runPlugin(root, ["marketplace", "list", "--json"]),
    runPlugin(root, ["list", "--json", "--available"]),
  ])
  if (!markets.ok) throw new Error(failure(markets))
  if (!plugins.ok) throw new Error(failure(plugins))
  const parsedMarkets = parseJson(markets.stdout) as unknown[] | null
  const parsed = parseJson(plugins.stdout) as { installed?: unknown[]; available?: unknown[] } | null
  if (!Array.isArray(parsedMarkets) || !parsed) throw new Error("The plugin command returned unreadable output.")
  return {
    marketplaces: parsedMarkets,
    installed: await Promise.all((parsed.installed ?? []).map(withManifest)),
    available: parsed.available ?? [],
  }
}

export async function pluginAction(root: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const { action, target, sparse, scope } = (body ?? {}) as { action?: unknown; target?: unknown; sparse?: unknown; scope?: unknown }
  if (typeof action !== "string" || !(action in ACTIONS)) return { status: 400, body: { error: "Unknown action." } }
  const command = ACTIONS[action as PluginAction]
  const isUpdate = action === "marketplace-update"
  if (typeof target !== "string" && !isUpdate) return { status: 400, body: { error: "Missing target." } }

  const args: string[] = [...command]
  if (typeof target === "string" && target) {
    const value = target.trim()
    // A new marketplace source may be a URL, a path or owner/repo; every other target is a plain name.
    const valid = action === "marketplace-add" ? value.length > 0 && !value.startsWith("-") : NAME.test(value)
    if (!valid) return { status: 400, body: { error: "Invalid target." } }
    args.push(value)
  }
  if (action === "marketplace-add" && typeof sparse === "string" && sparse.trim()) {
    const paths = sparse.split(/[\s,]+/).filter(Boolean)
    if (paths.some((path) => path.startsWith("-"))) return { status: 400, body: { error: "Invalid sparse path." } }
    // The option is variadic, so it goes after the source.
    args.push("--sparse", ...paths)
  }
  if (action !== "marketplace-add" && action !== "marketplace-remove" && action !== "marketplace-update") {
    // Enable, disable and uninstall must act on the scope the plugin was installed at.
    const chosen = scope === undefined ? "user" : scope
    if (chosen !== "user" && chosen !== "project" && chosen !== "local") return { status: 400, body: { error: "Invalid scope." } }
    args.push("--scope", chosen)
  }

  const result = await runPlugin(root, args)
  if (!result.ok) return { status: 400, body: { error: failure(result) } }
  return { status: 200, body: { ok: true } }
}
