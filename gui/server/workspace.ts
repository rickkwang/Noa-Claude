import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { opendir, readdir, realpath, stat, lstat, readFile, writeFile, rename, chmod, unlink } from "node:fs/promises"
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

const MEDIA_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".flac": "audio/flac",
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
}

export async function mediaResponse(cwd: string, path: string, request: Request): Promise<Response> {
  const target = await inside(cwd, path)
  const type = MEDIA_TYPES[extname(target).toLowerCase()]
  if (!type) return new Response("Unsupported media type", { status: 415 })
  const file = Bun.file(target)
  const info = await stat(target)
  if (!info.isFile()) return new Response("Not a media file", { status: 400 })
  const headers = new Headers({ "Content-Type": type, "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff" })
  if (new URL(request.url).searchParams.has("download")) headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(path.split("/").pop()!)}`)
  let start = 0, end = info.size - 1
  const range = request.headers.get("range")
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } })
    if (!match[1]) start = Math.max(0, info.size - Number(match[2]))
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
    if (start > end || start >= info.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } })
    headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`)
  }
  headers.set("Content-Length", String(Math.max(0, end - start + 1)))
  return new Response(request.method === "HEAD" ? null : file.slice(start, end + 1), { status: range ? 206 : 200, headers })
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

// Local branches for the composer's branch switcher: the default branch first,
// the current branch, then the rest by most recent commit.
async function branches(cwd: string) {
  if (!(await git(cwd, ["rev-parse", "--is-inside-work-tree"]).catch(() => "")).trim()) return { isGit: false as const }
  const [current, refs, origin, status, head] = await Promise.all([
    git(cwd, ["branch", "--show-current"]),
    git(cwd, ["for-each-ref", "--sort=-committerdate", "--count=500", "--format=%(refname:short)", "refs/heads"]),
    git(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], [0, 1, 128]),
    git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=no"]),
    git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"], [0, 1]),
  ])
  const local = refs.split("\n").filter(Boolean)
  const remoteDefault = origin.trim().replace(/^origin\//, "")
  const ordered = [...new Set([...(local.includes(remoteDefault) ? [remoteDefault] : []), ...(current.trim() ? [current.trim()] : []), ...local])]
  return {
    isGit: true as const,
    current: current.trim() || null,
    defaultBranch: local.includes(remoteDefault) ? remoteDefault : null,
    branches: ordered,
    // Tracked changes only: untracked files follow the checkout and never block it.
    uncommitted: countStatusEntries(status),
    hasCommits: head.trim() !== "",
  }
}

// Porcelain -z records; a rename or copy carries its source path as one extra record.
function countStatusEntries(raw: string) {
  const records = raw.split("\0").filter(Boolean)
  let count = 0
  for (let i = 0; i < records.length; i++) {
    count++
    if (/^[RC]/.test(records[i]!)) i++
  }
  return count
}

async function switchBranch(cwd: string, body: { action?: unknown; branch?: unknown }) {
  const name = typeof body?.branch === "string" ? body.branch.trim() : ""
  if (!name) throw new Error("Enter a branch name")
  const state = await branches(cwd)
  if (!state.isGit) throw new Error("This project is not a Git repository")
  if (body.action === "create") {
    if (!state.hasCommits) throw new Error("Commit changes to create and checkout a new branch")
    if (name.endsWith("/")) throw new Error("Branch name cannot end with “/”.")
    if (name.startsWith("-") || !(await git(cwd, ["check-ref-format", "--branch", name]).then(() => true, () => false)))
      throw new Error("Enter a valid branch name")
    if (state.branches.includes(name)) throw new Error("Branch already exists.")
    await git(cwd, ["switch", "-c", name])
    return { ok: true }
  }
  if (body.action !== "checkout") throw new Error("Invalid branch action")
  if (!state.branches.includes(name)) throw new Error("That branch no longer exists")
  if (name === state.current) return { ok: true }
  // Uncommitted tracked changes must be committed before switching branches.
  if (state.uncommitted > 0) throw Object.assign(new Error(`Commit changes in ${state.uncommitted} ${state.uncommitted === 1 ? "file" : "files"} to check out ${name}.`), { uncommitted: state.uncommitted })
  await git(cwd, ["switch", "--no-guess", name])
  return { ok: true }
}

async function diff(cwd: string, path: string, scope: string, context: string | null) {
  if (!path) throw new Error("Select a file")
  await inside(cwd, path, true)
  const listing = await changes(cwd, scope, path)
  const file = listing.files.find((f) => f.path === path)
  if (!file) return { content: "", snapshot: "", additions: 0, deletions: 0 }
  const hasHead = await git(cwd, ["rev-parse", "--verify", "HEAD"]).then(() => true, () => false)
  const contents = await (async () => {
    const target = await inside(cwd, path)
    const info = await stat(target)
    if (!info.isFile()) return undefined
    if (scope === "staged" && info.size > MAX_PREVIEW) {
      const hash = createHash("sha256")
      for await (const chunk of createReadStream(target)) hash.update(chunk as Buffer)
      return { info, revision: hash.digest("hex"), binary: false, content: "" }
    }
    return textFile(cwd, path)
  })().catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT" || error.code === "EISDIR") return undefined; throw error })
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

// The editors Claude Code's "Open in" menu offers for files (Xcode is left out there), opened through
// their URL schemes. An editor counts as installed when its app bundle (or, off macOS, its CLI) exists.
const EDITORS = [
  { type: "vscode", name: "VS Code", scheme: "vscode", apps: ["Visual Studio Code.app", "Visual Studio Code - Insiders.app"], cli: "code" },
  { type: "cursor", name: "Cursor", scheme: "cursor", apps: ["Cursor.app"], cli: "cursor" },
  { type: "windsurf", name: "Windsurf", scheme: "windsurf", apps: ["Windsurf.app"], cli: "windsurf" },
  { type: "zed", name: "Zed", scheme: "zed", apps: ["Zed.app"], cli: "zed" },
] as const

async function installedEditors() {
  const roots = ["/Applications", `${process.env.HOME ?? ""}/Applications`]
  const found = await Promise.all(EDITORS.map(async (editor) => {
    if (process.platform !== "darwin") return Bun.which(editor.cli) !== null
    for (const root of roots) for (const app of editor.apps) if (await stat(`${root}/${app}`).catch(() => undefined)) return true
    return false
  }))
  return EDITORS.filter((_, i) => found[i]).map(({ type, name }) => ({ type, name })).sort((a, b) => a.name.localeCompare(b.name))
}

function launch(args: string[]) {
  Bun.spawn(args, { stdout: "ignore", stderr: "ignore", stdin: "ignore" }).unref()
}

async function openIn(cwd: string, request: { path?: unknown; target?: unknown }) {
  if (typeof request?.path !== "string" || typeof request.target !== "string") throw new Error("Invalid open request")
  const target = await inside(cwd, request.path)
  const info = await stat(target)
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open"
  if (request.target === "finder") {
    if (process.platform === "darwin") launch(["open", "-R", target])
    else if (process.platform === "win32") launch(["explorer", `/select,${target}`])
    else launch(["xdg-open", info.isDirectory() ? target : dirname(target)])
    return { ok: true }
  }
  const editor = EDITORS.find((e) => e.type === request.target)
  if (!editor || !(await installedEditors()).some((e) => e.type === editor.type)) throw new Error("That editor isn't installed")
  // Same guard as Claude Code: characters that change a URI's meaning are refused rather than escaped.
  if (/[%#?\\]/.test(target)) throw new Error("This path can't be opened in an editor")
  launch([opener, `${editor.scheme}://file${encodeURIComponent(target).replace(/%2F/g, "/")}`])
  return { ok: true }
}

// File content search, after Claude Code's: ripgrep (git grep when rg is missing), at most 6 matches per
// file, stopping once `cap` matches are in but finishing the current file, with a 200-character preview
// window that keeps 40 characters before the match. Smart case: an all-lowercase query ignores case.
const GREP_PER_FILE = 6
const GREP_PREVIEW = 200
const GREP_LEAD = GREP_PREVIEW / 5
const GREP_TIMEOUT = 8000
type GrepMatch = { path: string; line: number; column: number; preview: string }

function previewAround(text: string, index: number) {
  if (text.length <= GREP_PREVIEW) return text
  let start = Math.min(Math.max(0, index - GREP_LEAD), text.length - GREP_PREVIEW)
  if (/[\uDC00-\uDFFF]/.test(text.charAt(start))) start++
  let end = Math.min(start + GREP_PREVIEW, text.length)
  if (end < text.length && /[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end--
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`
}

function grepCollector(cap: number) {
  const out: GrepMatch[] = [], perFile = new Map<string, number>()
  let finishing: string | undefined
  return {
    out,
    // "stop" ends the search: the cap is reached and the file it was reached in is complete.
    add(match: GrepMatch): "stop" | undefined {
      if (finishing !== undefined && match.path !== finishing) return "stop"
      const count = perFile.get(match.path) ?? 0
      if (count < GREP_PER_FILE) { perFile.set(match.path, count + 1); out.push(match) }
      if (out.length >= cap) { if (count + 1 >= GREP_PER_FILE) return "stop"; finishing = match.path }
    },
  }
}

async function streamLines(args: string[], cwd: string, onLine: (line: string) => "stop" | undefined, signal?: AbortSignal) {
  const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "ignore", stdin: "ignore" })
  const timer = setTimeout(() => proc.kill(), GREP_TIMEOUT)
  // A request the client abandoned (a newer query) stops its search.
  const abandon = () => proc.kill()
  signal?.addEventListener("abort", abandon)
  const decoder = new TextDecoder()
  let buffered = ""
  try {
    const reader = proc.stdout.getReader()
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      buffered += decoder.decode(chunk.value, { stream: true })
      let newline
      while ((newline = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, newline)
        buffered = buffered.slice(newline + 1)
        if (onLine(line) === "stop") { proc.kill(); return }
      }
    }
    if (buffered) onLine(buffered)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", abandon)
    await proc.exited
  }
}

// git grep accepts -m (matches per file) from 2.38, as Claude Code checks before passing it.
let gitGrepMaxCount: Promise<boolean> | undefined
function gitSupportsMaxCount() {
  gitGrepMaxCount ??= git(".", ["--version"]).then((out) => {
    const [, major, minor] = /git version (\d+)\.(\d+)/.exec(out) ?? []
    return Number(major) > 2 || Number(major) === 2 && Number(minor) >= 38
  }, () => false)
  return gitGrepMaxCount
}

async function grep(cwd: string, query: string, cap: number, signal?: AbortSignal) {
  const pattern = query.trim()
  if (!pattern) return { matches: [] }
  const root = await realpath(cwd)
  const collector = grepCollector(cap)
  const rg = Bun.which("rg", { PATH: `${process.env.PATH ?? ""}:/opt/homebrew/bin:/usr/local/bin` })
  if (rg) {
    await streamLines([rg, "--json", "--no-config", "-S", "--fixed-strings", "--crlf", "--max-count", String(GREP_PER_FILE), "-g", "!node_modules", "--", pattern], root, (line) => {
      let event: { type?: string; data?: { path?: { text?: string }; lines?: { text?: string }; line_number?: number; submatches?: { start: number }[] } }
      try { event = JSON.parse(line) } catch { return }
      const data = event.data
      if (event.type !== "match" || !data?.path?.text || data.lines?.text === undefined) return
      const text = data.lines.text.replace(/\r?\n$/, "")
      const byteStart = data.submatches?.[0]?.start ?? 0
      const index = Buffer.from(text).subarray(0, byteStart).toString("utf8").length
      return collector.add({ path: data.path.text.replaceAll("\\", "/"), line: data.line_number ?? 1, column: index + 1, preview: previewAround(text, index) })
    }, signal)
  } else {
    const insensitive = pattern === pattern.toLowerCase()
    await streamLines(["git", "--no-optional-locks", "-C", root, "grep", "--no-index", "--exclude-standard", "-nIz", "--fixed-strings", ...(insensitive ? ["-i"] : []), ...(await gitSupportsMaxCount() ? ["-m", String(GREP_PER_FILE)] : []), "-e", pattern, "--", ":(exclude,glob)**/node_modules/**", ":(exclude,glob)**/.*", ":(exclude,glob)**/.*/**"], root, (line) => {
      const [path, lineNumber, ...rest] = line.split("\0")
      const text = rest.join("\0")
      if (!path || !lineNumber) return
      const index = Math.max(0, (insensitive ? text.toLowerCase() : text).indexOf(insensitive ? pattern.toLowerCase() : pattern))
      return collector.add({ path, line: Number(lineNumber), column: index + 1, preview: previewAround(text, index) })
    }, signal).catch(() => {})
  }
  return { matches: collector.out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }) || a.line - b.line) }
}

export async function workspaceRequest(url: URL, cwd: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const path = url.searchParams.get("path") ?? ""
  if (url.pathname === "/api/editors") return { editors: await installedEditors() }
  if (url.pathname === "/api/grep") return grep(cwd, url.searchParams.get("q") ?? "", Math.min(1000, Math.max(1, Number(url.searchParams.get("max")) || 241)), signal)
  if (url.pathname === "/api/open-in") return openIn(cwd, body as { path?: unknown; target?: unknown })
  if (url.pathname === "/api/branches") return body === undefined ? branches(cwd) : switchBranch(cwd, body as { action?: unknown; branch?: unknown })
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
    if (action.action === "revert" && scope === "all" && "oldPath" in current && current.oldPath) {
      const oldTarget = await inside(cwd, current.oldPath, true)
      const existing = await lstat(oldTarget).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error
        return undefined
      })
      if (existing) throw new Error(`Cannot restore ${current.oldPath}: that path was recreated. Move it before reverting ${action.path}.`)
    }
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
        await chmod(temporary, file.info.mode)
        await rename(temporary, file.target)
      } finally { await unlink(temporary).catch(() => {}) }
      return { content, revision: digest(content), kind: "text" }
    }
    const mime = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml" } as Record<string, string>)[extname(path).toLowerCase()]
    if (mime) return { kind: "image", dataUrl: `data:${mime};base64,${file.bytes.toString("base64")}` }
    return { kind: file.binary ? "binary" : "text", content: file.binary ? "Binary file cannot be previewed" : file.content, revision: file.revision }
  }
  // A present-but-empty `search` means "list every file", which the composer's @ menu needs.
  const search = url.searchParams.get("search")
  if (search !== null) {
    const needle = search.toLowerCase()
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
    const matches = names.filter((p) => p.toLowerCase().includes(needle))
    return { entries: matches.slice(0, 500).map((p) => ({ name: p.split("/").pop(), path: p, directory: false })), truncated: matches.length > 500 }
  }
  const target = await inside(cwd, path)
  const entries = (await readdir(target, { withFileTypes: true })).filter((e) => e.name !== ".git" && !e.isSymbolicLink()).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
  const ignored = new Set((await git(cwd, ["check-ignore", "-z", "--stdin"], [0, 1], entries.map((e) => `${path ? `${path}/` : ""}${e.name}${e.isDirectory() ? "/" : ""}\0`).join("")).catch(() => "")).split("\0"))
  const visible = entries.filter((e) => !ignored.has(`${path ? `${path}/` : ""}${e.name}${e.isDirectory() ? "/" : ""}`))
  // Directories that only contain one directory are shown as one row ("a/b/c"), pointing at the deepest one.
  const flatten = async (rel: string) => {
    for (let hops = 0; hops < 8; hops++) {
      const dir = await opendir(await inside(cwd, rel)).catch(() => undefined)
      if (!dir) break
      const seen: import("node:fs").Dirent[] = []
      try { for (let e = await dir.read(); e && seen.length < 3; e = await dir.read()) if (e.name !== ".git") seen.push(e) } finally { await Promise.resolve(dir.close()).catch(() => {}) }
      if (seen.length !== 1 || !seen[0]!.isDirectory()) break
      rel = `${rel}/${seen[0]!.name}`
    }
    return rel
  }
  const entriesOut = await Promise.all(visible.slice(0, 500).map(async (e) => {
    const own = path ? `${path}/${e.name}` : e.name
    const deepest = e.isDirectory() ? await flatten(own) : own
    return { name: deepest === own ? e.name : deepest.slice(own.length - e.name.length), path: deepest, directory: e.isDirectory() }
  }))
  return { entries: entriesOut, truncated: visible.length > 500 }
}
