import { createHash, randomUUID } from "node:crypto"
import { readdir, realpath, stat, readFile, writeFile, rename, unlink } from "node:fs/promises"
import { dirname, relative, resolve, sep, extname } from "node:path"
import { createTwoFilesPatch, parsePatch, formatPatch } from "diff"

const MAX_PREVIEW = 512 * 1024
const digest = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex")

async function inside(cwd: string, path: string, missing = false): Promise<string> {
  const root = await realpath(cwd)
  const target = resolve(root, path)
  const check = (value: string) => {
    const rel = relative(root, value)
    if (rel === ".." || rel.startsWith(`..${sep}`) || rel.split(sep).some((p) => p.toLowerCase() === ".git"))
      throw new Error("Path is outside the project or inside .git")
  }
  check(target)
  let existing = target
  while (missing && !(await stat(existing).catch(() => undefined))) existing = dirname(existing)
  const physical = await realpath(existing)
  check(physical)
  return missing ? target : physical
}

async function git(cwd: string, args: string[], accepted = [0], input?: string) {
  const proc = Bun.spawn(["git", "--no-optional-locks", "-C", cwd, ...args], {
    stdout: "pipe", stderr: "pipe", stdin: input === undefined ? "ignore" : new Blob([input]),
    env: { ...process.env, GIT_LITERAL_PATHSPECS: args[0] === "check-ignore" ? "0" : "1" },
  })
  const [text, error, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (!accepted.includes(code)) throw new Error(error.trim() || "Git command failed")
  return text
}

async function textFile(cwd: string, path: string) {
  const target = await inside(cwd, path)
  const info = await stat(target)
  if (!info.isFile()) throw Object.assign(new Error("Select a file to preview"), { code: "EISDIR" })
  if (info.size > MAX_PREVIEW) throw new Error("This file is too large to preview (512 KB limit)")
  const bytes = await readFile(target)
  return { target, info, bytes, revision: digest(bytes), binary: bytes.includes(0), content: bytes.toString("utf8") }
}

function numstat(raw: string) {
  const records = raw.split("\0")
  const result = new Map<string, { additions: number; deletions: number; binary: boolean }>()
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(record)
    if (!match) continue
    let path = match[3]!
    if (!path) { i++; path = records[++i] ?? "" }
    result.set(path, { additions: Number(match[1]) || 0, deletions: Number(match[2]) || 0, binary: match[1] === "-" })
  }
  return result
}

async function changes(cwd: string, scope: string, only?: string) {
  if (!(await git(cwd, ["rev-parse", "--is-inside-work-tree"]).catch(() => "" )).trim())
    return { isGit: false, branch: "", files: [], additions: 0, deletions: 0 }
  const hasHead = await git(cwd, ["rev-parse", "--verify", "HEAD"]).then(() => true, () => false)
  const [raw, prefix, branch, stats] = await Promise.all([
    git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]),
    git(cwd, ["rev-parse", "--show-prefix"]),
    git(cwd, ["branch", "--show-current"]),
    git(cwd, ["diff", "--numstat", "-z", "--no-ext-diff", "--no-textconv", ...(scope === "staged" ? ["--cached"] : scope === "unstaged" || !hasHead ? [] : ["HEAD"]), "--", "."]),
  ])
  const rootPrefix = prefix.replace(/\n$/, "")
  const counts = numstat(stats)
  const records = raw.split("\0").filter(Boolean)
  const files: { path: string; oldPath?: string; status: string; additions: number; deletions: number; binary: boolean }[] = []
  const counted: typeof files = []
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!, status = record.slice(0, 2), fullPath = record.slice(3)
    const oldPath = /[RC]/.test(status) ? records[++i] : undefined
    if (!fullPath.startsWith(rootPrefix)) continue
    const untracked = status === "??"
    if (scope === "staged" && (untracked || status[0] === " ")) continue
    if (scope === "unstaged" && !untracked && status[1] === " ") continue
    const path = fullPath.slice(rootPrefix.length)
    if (only !== undefined && path !== only) continue
    const count = counts.get(fullPath) ?? { additions: 0, deletions: 0, binary: false }
    const entry = { path, oldPath: oldPath?.startsWith(rootPrefix) ? oldPath.slice(rootPrefix.length) : undefined, status, ...count }
    files.push(entry)
    if (untracked || !hasHead && scope === "all") counted.push(entry)
  }
  // Untracked files have no numstat; count their lines with bounded concurrency.
  for (let i = 0; i < counted.length; i += 16) {
    await Promise.all(counted.slice(i, i + 16).map(async (entry) => {
      const file = await textFile(cwd, entry.path).catch(() => undefined)
      if (file) Object.assign(entry, { additions: file.binary || !file.content ? 0 : file.content.split("\n").length - Number(file.content.endsWith("\n")), deletions: 0, binary: file.binary })
    }))
  }
  return { isGit: true, branch: branch.trim() || "Detached HEAD", files, additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0) }
}

async function diff(cwd: string, path: string, scope: string, context: string | null) {
  if (!path) throw new Error("Select a file")
  await inside(cwd, path, true)
  const listing = await changes(cwd, scope, path)
  const file = listing.files.find((f) => f.path === path)
  if (!file) return { content: "", snapshot: "", additions: 0, deletions: 0 }
  const hasHead = await git(cwd, ["rev-parse", "--verify", "HEAD"]).then(() => true, () => false)
  const contents = await textFile(cwd, path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT" || error.code === "EISDIR") return undefined; throw error })
  const args = ["--no-ext-diff", "--no-textconv", "--no-color", context === "all" ? "--unified=100000" : "--unified=3"]
  const paths = file.oldPath ? [file.oldPath, path] : [path]
  const fromEmpty = file.status === "??" || !hasHead && scope === "all"
  const content = fromEmpty
    ? contents ? contents.binary ? "Binary file added" : createTwoFilesPatch("/dev/null", `b/${path}`, "", contents.content) : ""
    : await git(cwd, ["diff", ...args, ...(scope === "staged" ? ["--cached"] : scope === "all" && hasHead ? ["HEAD"] : []), "--", ...paths])
  const index = await git(cwd, ["ls-files", "--stage", "-z", "--", ...paths])
  const head = hasHead ? await git(cwd, ["rev-parse", "HEAD"]) : ""
  const snapshot = digest(file.status + index + head + (contents?.revision ?? "") + (contents?.info.mode ?? ""))
  return { ...file, content: content.length > MAX_PREVIEW ? "" : content, snapshot, truncated: content.length > MAX_PREVIEW, binary: file.binary || content.startsWith("Binary file") }
}

export async function workspaceRequest(url: URL, cwd: string, body?: unknown): Promise<unknown> {
  const path = url.searchParams.get("path") ?? ""
  const scope = url.searchParams.get("scope") ?? "all"
  if (!["all", "staged", "unstaged"].includes(scope)) throw new Error("Invalid changes scope")
  if (url.pathname === "/api/git-action") {
    const action = body as { action?: string; path?: string; snapshot?: string; scope?: string; hunk?: number }
    if (action?.action === "init") { await git(cwd, ["init"]); return { ok: true } }
    if (!action?.path || !["stage", "unstage", "revert", "stage-hunk", "unstage-hunk", "revert-hunk"].includes(action.action ?? "")) throw new Error("Invalid Git action")
    const current = await diff(cwd, action.path, scope, url.searchParams.get("context"))
    if (!current.snapshot || current.snapshot !== action.snapshot) throw new Error("The file changed since it was loaded. Refresh before continuing.")
    if ("status" in current && /U|AA|DD/.test(current.status)) throw new Error("Resolve merge conflicts before applying this action")
    const paths = "oldPath" in current && current.oldPath ? [current.oldPath, action.path] : [action.path]
    if (action.action?.endsWith("-hunk")) {
      if (scope === "all" || action.action === "stage-hunk" && scope !== "unstaged" || action.action === "unstage-hunk" && scope !== "staged") throw new Error("Choose the staged or unstaged view before applying a hunk")
      if ("oldPath" in current && current.oldPath) throw new Error("Apply renamed files as a whole")
      const patch = parsePatch(current.content)[0]
      const hunk = Number.isInteger(action.hunk) ? patch?.hunks[action.hunk!] : undefined
      if (!patch || !hunk) throw new Error("The requested hunk is no longer available")
      const prefix = (await git(cwd, ["rev-parse", "--show-prefix"])).replace(/\n$/, "")
      const content = formatPatch({ ...patch, oldFileName: patch.oldFileName === "/dev/null" ? "/dev/null" : JSON.stringify(`a/${prefix}${action.path}`), newFileName: patch.newFileName === "/dev/null" ? "/dev/null" : JSON.stringify(`b/${prefix}${action.path}`), hunks: [hunk] })
      const args = [...(action.action === "stage-hunk" || scope === "staged" ? ["--cached"] : []), ...(action.action === "stage-hunk" ? [] : ["--reverse"])]
      await git(cwd, ["apply", "--check", ...args], [0], content)
      await git(cwd, ["apply", ...args], [0], content)
      return { ok: true }
    }
    if (action.action === "stage") await git(cwd, ["add", "-A", "--", action.path])
    else if (action.action === "unstage") {
      const head = await git(cwd, ["rev-parse", "--verify", "HEAD"]).then(() => true, () => false)
      await git(cwd, head ? ["restore", "--staged", "--", ...paths] : ["rm", "--cached", "--", ...paths])
    } else {
      if ("status" in current && current.status === "??") await unlink(await inside(cwd, action.path))
      else if (scope === "unstaged") await git(cwd, ["restore", "--worktree", "--", action.path])
      else if ("status" in current && current.status.includes("A")) {
        await git(cwd, ["rm", "--cached", "--", action.path])
        if (scope !== "staged") await unlink(await inside(cwd, action.path))
      } else await git(cwd, ["restore", "--source=HEAD", ...(scope === "staged" ? ["--staged"] : ["--staged", "--worktree"]), "--", ...paths])
    }
    return { ok: true }
  }
  if (url.pathname === "/api/changes") return changes(cwd, scope)
  if (url.pathname === "/api/diff") return diff(cwd, path, scope, url.searchParams.get("context"))
  if (url.pathname === "/api/file") {
    const file = await textFile(cwd, path)
    if (body !== undefined) {
      const update = body as { content?: string; revision?: string }
      if (typeof update?.content !== "string" || Buffer.byteLength(update.content) > MAX_PREVIEW) throw new Error("Invalid file content or preview limit exceeded")
      if (file.binary || !Buffer.from(file.content, "utf8").equals(file.bytes))
        throw new Error("Only UTF-8 text files can be saved here")
      if (update.revision !== file.revision) throw new Error("The file changed on disk. Your draft was kept; reload before saving.")
      const content = file.content.includes("\r\n") && !file.content.replaceAll("\r\n", "").includes("\n")
        ? update.content.replace(/\r?\n/g, "\r\n") : update.content
      if (Buffer.byteLength(content) > MAX_PREVIEW) throw new Error("Invalid file content or preview limit exceeded")
      const temporary = `${file.target}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, content, { flag: "wx", mode: file.info.mode })
        if (digest(await readFile(file.target)) !== file.revision) throw new Error("The file changed on disk. Your draft was kept; reload before saving.")
        await rename(temporary, file.target)
      } finally { await unlink(temporary).catch(() => {}) }
      return { content, revision: digest(content), kind: "text" }
    }
    const mime = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" } as Record<string, string>)[extname(path).toLowerCase()]
    if (mime) return { kind: "image", dataUrl: `data:${mime};base64,${file.bytes.toString("base64")}` }
    return { kind: file.binary ? "binary" : "text", content: file.binary ? "Binary file cannot be previewed" : file.content, revision: file.revision }
  }
  const search = url.searchParams.get("search")?.toLowerCase()
  if (search) {
    let names: string[]
    try {
      // ls-files already prints paths relative to cwd; hide tracked files deleted from disk.
      const [listed, deleted] = await Promise.all([
        git(cwd, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."]),
        git(cwd, ["ls-files", "--deleted", "-z", "--", "."]),
      ])
      const gone = new Set(deleted.split("\0"))
      names = [...new Set(listed.split("\0").filter((p) => p && !gone.has(p)))]
    } catch {
      names = []
      const visit = async (dir: string) => {
        if (names.length >= 10000) return
        for (const entry of await readdir(await inside(cwd, dir), { withFileTypes: true })) {
          if (names.length >= 10000) break
          if (entry.name === ".git" || entry.isSymbolicLink()) continue
          const child = dir ? `${dir}/${entry.name}` : entry.name
          if (entry.isDirectory()) await visit(child); else names.push(child)
        }
      }
      await visit("")
    }
    const matches = names.filter((p) => p.toLowerCase().includes(search))
    return { entries: matches.slice(0, 500).map((p) => ({ name: p.split("/").pop(), path: p, directory: false })), truncated: matches.length > 500 }
  }
  const target = await inside(cwd, path)
  const entries = (await readdir(target, { withFileTypes: true })).filter((e) => e.name !== ".git" && !e.isSymbolicLink()).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
  const ignored = new Set((await git(cwd, ["check-ignore", "-z", "--stdin"], [0, 1], entries.map((e) => `${path ? `${path}/` : ""}${e.name}${e.isDirectory() ? "/" : ""}\0`).join("")).catch(() => "")).split("\0"))
  const visible = entries.filter((e) => !ignored.has(`${path ? `${path}/` : ""}${e.name}${e.isDirectory() ? "/" : ""}`))
  return { entries: visible.slice(0, 500).map((e) => ({ name: e.name, path: path ? `${path}/${e.name}` : e.name, directory: e.isDirectory() })), truncated: visible.length > 500 }
}
