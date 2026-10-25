// Per-turn diffs come from a disposable git index + object directory. The user's
// real index and object database are never touched: `git add` writes blobs into a
// temp object dir, and the diff reads the repo objects through an alternate.
import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, join, relative } from "node:path"
import { createTwoFilesPatch, diffLines } from "diff"
import type { TurnDiff, TurnDiffActionResult, TurnDiffFile } from "../src/agent/protocol"

const MAX_PATCH = 1_000_000
const MAX_FILE_LINES = 5_000
const ENV = process.env

export interface TreeSnapshot {
  tree: string
  objects: string
  repoObjects: string
  temp: string
}

async function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = ENV, accepted = [0]) {
  const proc = Bun.spawn(["git", "--no-optional-locks", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...env, GIT_LITERAL_PATHSPECS: "1" },
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (!accepted.includes(code)) throw new Error(stderr.trim() || `git ${args[0]} failed`)
  return stdout
}

/** Capture the working tree under `cwd` as a tree object, or null outside git. */
export async function captureTree(cwd: string): Promise<TreeSnapshot | null> {
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]).catch(() => "")
  if (inside.trim() !== "true") return null

  const [repoObjects, indexPath, root] = await Promise.all([
    git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "objects"]),
    git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"]).catch(() => ""),
    git(cwd, ["rev-parse", "--show-toplevel"]),
  ])
  const repo = repoObjects.trim()
  const indexSource = indexPath.trim()
  // Snapshot the whole worktree, as Codex's patch batches can cover cwds other
  // than the one the turn started in. Paths are narrowed to `cwd` for display.
  const top = root.trim()
  const temp = await mkdtemp(join(tmpdir(), "noa-turn-"))
  const index = join(temp, "index")
  const objects = join(temp, "objects")
  await mkdir(objects)
  const env = {
    ...ENV,
    GIT_INDEX_FILE: index,
    GIT_OBJECT_DIRECTORY: objects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: repo,
  }
  try {
    if (indexSource) await cp(indexSource, index).catch(() => undefined)
    await git(top, ["add", "-A"], env)
    const tree = (await git(top, ["write-tree"], env)).trim()
    if (!tree) throw new Error("git write-tree returned nothing")
    return { tree, objects, repoObjects: repo, temp }
  } catch {
    await rm(temp, { recursive: true, force: true })
    return null
  }
}

function parseNumstat(raw: string, display: (path: string) => string): TurnDiffFile[] {
  const files: TurnDiffFile[] = []
  for (const record of raw.split("\0")) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(record)
    if (!match) continue
    const binary = match[1] === "-"
    const additions = binary ? 0 : Number(match[1])
    const deletions = binary ? 0 : Number(match[2])
    const patchPath = match[3]!
    const filePath = display(patchPath)
    files.push({
      path: filePath,
      patchPath: patchPath === filePath ? undefined : patchPath,
      additions,
      deletions,
      binary: binary || undefined,
      tooLarge: !binary && additions + deletions > MAX_FILE_LINES ? true : undefined,
    })
  }
  // Keep git's patch order; undo maps patch sections back to these paths.
  return files
}

export interface ChangeCollector {
  // Absolute path -> content before the first edit this turn. null means the
  // file did not exist, which is how tool results report a create.
  files: Map<string, string | null>
}

export function createChangeCollector(): ChangeCollector {
  return { files: new Map() }
}

/**
 * Remember the pre-edit content carried by Edit/Write/MultiEdit tool results.
 * This is the non-git fallback: the CLI's full tool output includes the
 * original file and the structured patch, so no snapshots are needed.
 */
export function trackToolResult(collector: ChangeCollector, result: unknown): boolean {
  if (!result || typeof result !== "object") return false
  const output = result as { type?: unknown; filePath?: unknown; originalFile?: unknown }
  if (typeof output.filePath !== "string") return false
  if (output.type !== "create" && output.type !== "update" && output.type !== "delete") return false
  if (collector.files.has(output.filePath)) return true
  if (output.type === "create") {
    collector.files.set(output.filePath, null)
    return true
  }
  if (typeof output.originalFile !== "string") return false
  collector.files.set(output.filePath, output.originalFile)
  return true
}

function binary(text: string) {
  return text.includes("\0")
}

/** Build a display diff from the tool results collected during a turn. */
export async function collectDiff(cwd: string, collector: ChangeCollector): Promise<TurnDiff | null> {
  const files: TurnDiffFile[] = []
  const patches: string[] = []
  let additions = 0
  let deletions = 0
  const entries = [...collector.files.entries()].sort(([a], [b]) => a.localeCompare(b))
  for (const [path, original] of entries) {
    const current = await readFile(path, "utf8").catch(() => null)
    if (current === original) continue
    const display = relative(cwd, path).split("\\").join("/")
    if ((original && binary(original)) || (current && binary(current))) {
      files.push({ path: display, additions: 0, deletions: 0, binary: true })
      continue
    }
    const changes = diffLines(original ?? "", current ?? "")
    const added = changes.reduce((sum, part) => sum + (part.added ? part.count ?? 0 : 0), 0)
    const removed = changes.reduce((sum, part) => sum + (part.removed ? part.count ?? 0 : 0), 0)
    additions += added
    deletions += removed
    files.push({
      path: display,
      additions: added,
      deletions: removed,
      tooLarge: added + removed > MAX_FILE_LINES ? true : undefined,
    })
    if (added + removed <= MAX_FILE_LINES)
      patches.push(createTwoFilesPatch(display, display, original ?? "", current ?? "", "", "", { context: 3 }))
  }
  if (files.length === 0) return null
  const patch = patches.join("")
  if (!patch) return { files, additions, deletions, truncated: true }
  if (patch.length > MAX_PATCH) return { files, additions, deletions, truncated: true }
  return { files, additions, deletions, patch }
}

/** Diff two captured trees. Paths are reported relative to `cwd`. */
export async function diffTrees(cwd: string, before: TreeSnapshot, after: TreeSnapshot, maxPatch = MAX_PATCH): Promise<TurnDiff | null> {
  if (before.tree === after.tree) return null
  const env = {
    ...ENV,
    GIT_OBJECT_DIRECTORY: after.objects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: [before.objects, after.objects, before.repoObjects].join(delimiter),
  }
  const [numstat, patch, prefix] = await Promise.all([
    git(cwd, ["diff-tree", "--no-commit-id", "-r", "--numstat", "-z", "--no-renames", before.tree, after.tree], env),
    git(cwd, ["diff-tree", "--no-commit-id", "-r", "-p", "--binary", "--no-renames", before.tree, after.tree], env),
    git(cwd, ["rev-parse", "--show-prefix"]).catch(() => ""),
  ])
  // diff-tree paths are repo-relative; report them relative to cwd. Using
  // --show-prefix avoids symlinked temp paths breaking relative().
  const root = prefix.trim()
  const depth = root.split("/").filter(Boolean).length
  const display = (path: string) =>
    root && path.startsWith(root) ? path.slice(root.length) : `${"../".repeat(depth)}${path}`
  const files = parseNumstat(numstat, display)
  if (files.length === 0) return null
  const additions = files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0)
  if (patch.length > maxPatch) return { files, additions, deletions, truncated: true }
  return { files, additions, deletions, patch }
}

async function applyFile(root: string, patch: string, reverse: boolean, check = false) {
  const proc = Bun.spawn(
    ["git", "--no-optional-locks", "-C", root, "apply", "--binary", ...(check ? ["--check"] : []), ...(reverse ? ["--reverse"] : []), "--whitespace=nowarn", "-"],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  )
  proc.stdin.write(patch)
  proc.stdin.flush()
  proc.stdin.end()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  return { ok: code === 0, stderr: stderr.trim() }
}

/** Undo (reverse) or reapply a turn's patch file by file, as Codex's patch actions. */
export async function applyTurnDiff(cwd: string, patch: string | undefined, reverse: boolean, paths: string[]): Promise<TurnDiffActionResult> {
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]).catch(() => "")
  if (inside.trim() !== "true")
    return { ok: false, errorCode: "not-git-repo", appliedPaths: [], skippedPaths: [], conflictedPaths: [] }
  if (!patch || !patch.trim())
    return { ok: false, errorCode: "no-patch", appliedPaths: [], skippedPaths: [], conflictedPaths: [] }
  const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim()
  // Check and apply the complete batch atomically, as Codex's atomic mode.
  const check = await applyFile(root, patch, reverse, true)
  if (!check.ok) return {
    ok: false, errorCode: "apply-failed", error: check.stderr,
    appliedPaths: [], skippedPaths: [],
    conflictedPaths: /conflict|does not apply|patch failed/i.test(check.stderr) ? paths : [],
  }
  const result = await applyFile(root, patch, reverse)
  return {
    ok: result.ok, errorCode: result.ok ? undefined : "apply-failed", error: result.stderr || undefined,
    appliedPaths: result.ok ? paths : [], skippedPaths: result.ok ? [] : paths, conflictedPaths: [],
  }
}

/**
 * Split a full diff into the capped client view and the uncapped patch kept in
 * the sidecar for Undo. Codex keeps the full unified diff for patch actions.
 */
export function diffForView(diff: TurnDiff): { diff: TurnDiff; fullPatch?: string } {
  if (diff.patch && diff.patch.length > MAX_PATCH)
    return { diff: { ...diff, patch: undefined, truncated: true }, fullPatch: diff.patch }
  return { diff }
}

export async function disposeSnapshot(snapshot: TreeSnapshot | null | undefined) {
  if (snapshot) await rm(snapshot.temp, { recursive: true, force: true }).catch(() => undefined)
}

/** Size of a transcript before a turn, used to find the turn's user message later. */
export async function fileSize(path: string) {
  return stat(path).then((info) => info.size, () => 0)
}
