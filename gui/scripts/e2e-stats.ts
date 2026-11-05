// Runs the real bridge against a disposable config dir and checks /api/stats for each range.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const gui = resolve(import.meta.dir, "..")
const config = mkdtempSync(join(tmpdir(), "noa-stats-e2e-"))
const project = join(config, "projects", "-tmp-stats-fixture")
mkdirSync(project, { recursive: true })

// Noon local time keeps each session inside one calendar day.
function daysAgo(days: number, minutes = 0): string {
  const date = new Date()
  date.setHours(12, minutes, 0, 0)
  date.setDate(date.getDate() - days)
  return date.toISOString()
}
function session(days: number, model: string, outputTokens: number, messages: number) {
  const id = crypto.randomUUID()
  const lines = Array.from({ length: messages }, (_, i) => JSON.stringify(i % 2
    ? { type: "assistant", uuid: crypto.randomUUID(), sessionId: id, timestamp: daysAgo(days, i), message: { id: `msg_${id}_${i}`, role: "assistant", model, content: [{ type: "text", text: "ok" }], usage: { input_tokens: 10, output_tokens: outputTokens } } }
    : { type: "user", uuid: crypto.randomUUID(), sessionId: id, timestamp: daysAgo(days, i), message: { role: "user", content: "hi" } }))
  writeFileSync(join(project, `${id}.jsonl`), `${lines.join("\n")}\n`)
}
session(0, "claude-opus-5-5", 100, 3)
session(20, "claude-sonnet-5-5", 5000, 2)
session(60, "claude-sonnet-5-5", 5000, 2)

const port = 20000 + Math.floor(Math.random() * 20000)
const bridge = Bun.spawn(["bun", "run", "server/main.ts"], {
  cwd: gui,
  env: { ...process.env, NOA_GUI_INSECURE: "1", NOA_GUI_TOKEN: "", NOA_GUI_PORT: String(port), CLAUDE_CONFIG_DIR: config },
  stdout: "ignore",
  stderr: "pipe",
})
const base = `http://127.0.0.1:${port}`
const stats = async (range: string) => {
  const response = await fetch(`${base}/api/stats?range=${range}`)
  assert.equal(response.status, 200, `range ${range}`)
  return await response.json() as Record<string, unknown>
}

try {
  for (let i = 0; ; i++) {
    if (await fetch(`${base}/api/runs`).then(r => r.ok, () => false)) break
    if (i > 100) throw new Error(`bridge did not start: ${await new Response(bridge.stderr).text()}`)
    await Bun.sleep(100)
  }

  const week = await stats("7d")
  assert.equal(week.range, "7d")
  assert.equal(week.totalSessions, "1")
  assert.equal(week.favoriteModel, "Opus 5.5")
  assert.equal(week.activeDays, 1)
  assert.equal((week.days as unknown[]).length, 1)
  // The title summary stays all-time whatever the range.
  assert.equal(week.allTimeMessages, "7")
  assert.equal(week.currentStreak, 1)
  console.log("PASS 7d range counts only this week but keeps the all-time summary")

  const month = await stats("30d")
  assert.equal(month.totalSessions, "2")
  assert.equal(month.favoriteModel, "Sonnet 5.5")
  assert.equal(month.allTimeMessages, "7")
  console.log("PASS 30d range picks the model with the most tokens")

  const all = await stats("all")
  assert.equal(all.totalSessions, "3")
  assert.equal(all.activeDays, 3)
  assert.equal(all.longestStreak, 1)
  console.log("PASS all-time range covers every session")

  assert.equal((await stats("bogus")).range, "all")
  assert.equal((await fetch(`${base}/api/stats`, { method: "POST" })).status, 405)
  console.log("PASS unknown ranges fall back to all-time and writes are refused")
} finally {
  bridge.kill()
  await bridge.exited
  rmSync(config, { recursive: true, force: true })
}
