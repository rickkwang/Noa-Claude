import assert from "node:assert/strict"

function element(state, text) {
  const line = state.split("\n").find((line) => line.includes(text))
  assert.ok(line, `Missing UI element: ${text}`)
  return Number(line.trim().match(/^\d+/)[0])
}

// Run with cua_repl against an isolated bridge fixture with a queued message.
export async function verifyQueuedGuiCommand(tab) {
  let state = await tab.getAXState({ emit: false, disableDiffing: true })
  await tab.click(element(state, "Edit queued message"))
  state = await tab.getAXState({ emit: false, disableDiffing: true })
  let input = element(state, "text entry area (settable)")
  await tab.click(input)
  await tab.pressKey(input, "super+a")
  await tab.typeText(input, "/new")
  state = await tab.getAXState({ emit: false, disableDiffing: true })
  await tab.click(element(state, "Save queued message"))
  state = await tab.getAXState({ emit: false, disableDiffing: true })
  assert.ok(state.includes("This command cannot be queued"), "Saving must reject GUI commands instead of executing them")
  assert.ok(state.includes("QUEUED_ORIGINAL"), "Rejected edits must preserve the queued message")
  assert.ok(state.includes("Cancel edit"), "Rejected edits must stay editable")
  input = element(state, "text entry area (settable)")
  await tab.click(input)
  await tab.pressKey(input, "super+a")
  await tab.typeText(input, "QUEUED_REVISED")
  state = await tab.getAXState({ emit: false, disableDiffing: true })
  await tab.click(element(state, "Save queued message"))
  state = await tab.getAXState({ emit: false, disableDiffing: true })
  assert.ok(state.includes("QUEUED_REVISED"), "Normal text must still save to the queue")
  assert.ok(state.includes("queued ·  paused"), "Saving must leave the queue paused")
  assert.ok(!state.includes("QUEUED_ORIGINAL"), "Successful save must replace the original queued text")
  return "PASS queued GUI command rejected without navigation; normal text saved with queue paused"
}
