import assert from "node:assert/strict"

function element(state, text) {
  const line = state.split("\n").find((line) => line.includes(text))
  assert.ok(line, `Missing UI element: ${text}`)
  return Number(line.trim().match(/^\d+/)[0])
}

// Run with cua_repl against an isolated desktop profile and a disposable file.
export async function verifyUnsavedQuit(app, fileName) {
  let state = await app.getAXState({ emit: false, disableDiffing: true })
  await app.click(element(state, `row ${fileName}`))
  state = await app.getAXState({ emit: false, disableDiffing: true })
  await app.click(element(state, "button Edit"))
  state = await app.getAXState({ emit: false, disableDiffing: true })
  const editor = state.split("\n").find((line) => line.includes("Edit file content"))
  assert.ok(editor, "File editor must be open")
  await app.click(Number(editor.trim().match(/^\d+/)[0]))
  await app.pressKey("super+a")
  await app.paste("UNSAVED_QUIT_REGRESSION")
  state = await app.getAXState({ emit: false, disableDiffing: true })
  await app.click(element(state, "close button"))
  state = await app.getAXState({ emit: false, disableDiffing: true })
  assert.ok(state.includes("Discard unsaved file edits?"), "Unsaved edits must get an explicit exit choice")
  await app.click(element(state, "button Keep editing"))
  state = await app.getAXState({ emit: false, disableDiffing: true })
  assert.ok(state.includes("UNSAVED_QUIT_REGRESSION"), "Cancelling quit must retain file edits")
  assert.match(state, /text entry area \(settable\).*Task instruction/, "Cancelling quit must keep the agent connected")
  return "PASS cancelling quit retains unsaved file edits and the agent connection"
}
