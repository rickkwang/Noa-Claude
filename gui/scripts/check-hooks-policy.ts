import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = mkdtempSync(join(tmpdir(), "noa-hooks-policy-"))
const config = join(root, "config"), managed = join(root, "managed")
mkdirSync(config)
mkdirSync(managed)
process.env.CLAUDE_CONFIG_DIR = config
// The source-only test override avoids writing to the machine's real policy directory.
process.env.USER_TYPE = "ant"
process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH = managed
const userFile = join(config, "settings.json"), policyFile = join(managed, "managed-settings.json")
const hooks = { PreToolUse: [{ hooks: [{ type: "command", command: "printf USER_VISIBLE_HOOK" }] }] }
writeFileSync(userFile, JSON.stringify({ hooks }))
const { getAllHooks } = await import("../../src/utils/hooks/hooksSettings")
const { shouldAllowManagedHooksOnly, shouldDisableAllHooksIncludingManaged } = await import("../../src/utils/hooks/hooksConfigSnapshot")
const { resetSettingsCache } = await import("../../src/utils/settings/settingsCache")
const { setOriginalCwd } = await import("../../src/bootstrap/state")
setOriginalCwd(root)
const state = { sessionHooks: new Map() } as any
try {
  assert.equal(getAllHooks(state).length, 1)
  assert.equal(getAllHooks(state)[0].config.command, "printf USER_VISIBLE_HOOK")
  writeFileSync(policyFile, JSON.stringify({ allowManagedHooksOnly: true, hooks }))
  resetSettingsCache()
  assert.equal(shouldAllowManagedHooksOnly(), true)
  assert.equal(getAllHooks(state).length, 0)
  console.log("PASS managed-only policy hides hook definitions through the CLI enumeration")
  writeFileSync(policyFile, JSON.stringify({ disableAllHooks: true }))
  resetSettingsCache()
  assert.equal(shouldDisableAllHooksIncludingManaged(), true)
  writeFileSync(policyFile, "{}")
  writeFileSync(userFile, JSON.stringify({ hooks, disableAllHooks: true }))
  resetSettingsCache()
  assert.equal(shouldAllowManagedHooksOnly(), true)
  assert.equal(shouldDisableAllHooksIncludingManaged(), false)
  console.log("PASS CLI restriction helpers distinguish custom-hook and managed-hook disable settings")
} finally {
  rmSync(root, { recursive: true, force: true })
}
process.exit(0)
