import { expect, test } from "bun:test"
import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listSessions, projectDir, renameSession } from "../server/sessions"
import { parseSessionInfoFromLite } from "../../src/utils/listSessionsImpl"

test("GUI and CLI agree on AI titles and externally updated manual titles", () => {
  const directory = mkdtempSync(join(tmpdir(), "noa-session-sync-"))
  const originalConfig = process.env.CLAUDE_CONFIG_DIR
  try {
    process.env.CLAUDE_CONFIG_DIR = join(directory, "config")
    const cwd = join(directory, "workspace")
    mkdirSync(cwd)
    mkdirSync(projectDir(cwd), { recursive: true })
    const id = crypto.randomUUID()
    const file = join(projectDir(cwd), `${id}.jsonl`)
    const transcript = [
      { type: "user", uuid: crypto.randomUUID(), cwd, timestamp: new Date().toISOString(), message: { content: "Original prompt" } },
      { type: "ai-title", sessionId: id, aiTitle: "CLI generated title" },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n"
    writeFileSync(file, transcript)
    const cli = parseSessionInfoFromLite(id, { head: transcript, tail: transcript, mtime: Date.now(), size: transcript.length })
    expect(cli?.summary).toBe("CLI generated title")
    expect(listSessions(cwd)[0]?.title).toBe(cli?.summary)
    renameSession(cwd, id, "Manual title")
    expect(listSessions(cwd)[0]?.title).toBe("Manual title")
    appendFileSync(file, JSON.stringify({ type: "ai-title", sessionId: id, aiTitle: "Later AI title" }) + "\n")
    expect(listSessions(cwd)[0]?.title).toBe("Manual title")
    appendFileSync(file, JSON.stringify({ type: "custom-title", sessionId: id, customTitle: "External rename" }) + "\n")
    expect(listSessions(cwd)[0]?.title).toBe("External rename")
    rmSync(file)
    expect(listSessions(cwd)).toEqual([])
  } finally {
    if (originalConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfig
    rmSync(directory, { recursive: true, force: true })
  }
})
