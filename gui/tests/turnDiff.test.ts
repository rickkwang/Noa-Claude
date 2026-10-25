import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyTurnDiff, captureTree, diffTrees, disposeSnapshot } from "../server/turnDiff"

test("turn undo rejects a conflicting file without applying any other file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "noa-turn-atomic-"))
  try {
    for (const args of [["init", "-q"], ["config", "user.email", "t@t"], ["config", "user.name", "t"]]) {
      const result = Bun.spawnSync(["git", "-C", cwd, ...args])
      if (result.exitCode !== 0) throw new Error(result.stderr.toString())
    }
    await writeFile(join(cwd, "a.txt"), "one\n")
    await writeFile(join(cwd, "b.txt"), "one\n")
    if (Bun.spawnSync(["git", "-C", cwd, "add", "."]).exitCode !== 0) throw new Error("add failed")
    if (Bun.spawnSync(["git", "-C", cwd, "commit", "-qm", "init"]).exitCode !== 0) throw new Error("commit failed")
    const before = await captureTree(cwd)
    await writeFile(join(cwd, "a.txt"), "two\n")
    await writeFile(join(cwd, "b.txt"), "two\n")
    const after = await captureTree(cwd)
    const diff = await diffTrees(cwd, before!, after!, Number.POSITIVE_INFINITY)
    await disposeSnapshot(before)
    await disposeSnapshot(after)
    await writeFile(join(cwd, "a.txt"), "conflicting\n")
    const result = await applyTurnDiff(cwd, diff!.patch, true, diff!.files.map((file) => file.path))
    expect(result.ok).toBe(false)
    expect(result.appliedPaths).toEqual([])
    expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("conflicting\n")
    expect(await readFile(join(cwd, "b.txt"), "utf8")).toBe("two\n")
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
