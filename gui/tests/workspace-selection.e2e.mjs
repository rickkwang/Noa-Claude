import assert from "node:assert/strict"

// Run with cua_repl against the isolated bridge fixture; no browser dependency is needed.
export async function verifyWorkspaceSelection(cua, origin, projectA, projectB) {
  const tabs = []
  try {
    const first = await cua.createBrowserTab("iab", `${origin}/?cwd=${encodeURIComponent(projectA)}`, { visible: false })
    tabs.push(first)
    const firstState = await first.getAXState({ emit: false, disableDiffing: true })
    assert.ok(firstState.includes("ONLY_PROJECT_A.txt"), "First tab must open project A")
    const second = await cua.createBrowserTab("iab", `${origin}/?cwd=${encodeURIComponent(projectB)}`, { visible: false })
    tabs.push(second)
    const secondState = await second.getAXState({ emit: false, disableDiffing: true })
    assert.ok(secondState.includes("ONLY_PROJECT_B.txt"), "Explicit project B must take precedence over saved project A")
    const restored = await cua.createBrowserTab("iab", origin, { visible: false })
    tabs.push(restored)
    const restoredState = await restored.getAXState({ emit: false, disableDiffing: true })
    assert.ok(restoredState.includes("ONLY_PROJECT_B.txt"), "Without an explicit workspace, restore the last project")
    return "PASS explicit workspace overrides saved state; default entry restores the last project"
  } finally {
    for (const tab of tabs) await tab.close()
  }
}
