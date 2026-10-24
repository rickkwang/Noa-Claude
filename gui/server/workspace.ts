import { readdir, realpath, stat } from "node:fs/promises"
import { relative, resolve, sep } from "node:path"

const MAX_PREVIEW = 512 * 1024

async function inside(cwd: string, path: string): Promise<string> {
  const root = await realpath(cwd)
  const target = await realpath(resolve(root, path))
  const rel = relative(root, target)
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.split(sep).includes(".git"))
    throw new Error("Path is outside the project or inside .git")
  return target
}

async function git(cwd: string, args: string[]) {
  const proc = Bun.spawn(["git", "--no-optional-locks", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" },
  })
  const [text, error, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(error.trim() || "Git command failed")
  return text
}

export async function workspaceRequest(url: URL, cwd: string): Promise<unknown> {
  const path = url.searchParams.get("path") ?? ""
  if (url.pathname === "/api/files") {
    const target = await inside(cwd, path)
    const entries = (await readdir(target, { withFileTypes: true }))
      .filter((e) => e.name !== ".git" && !e.isSymbolicLink())
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    return {
      entries: entries
        .slice(0, 500)
        .map((e) => ({ name: e.name, path: path ? `${path}/${e.name}` : e.name, directory: e.isDirectory() })),
      truncated: entries.length > 500,
    }
  }
  if (url.pathname === "/api/file") {
    const target = await inside(cwd, path)
    const info = await stat(target)
    if (!info.isFile()) throw new Error("Select a file to preview")
    if (info.size > MAX_PREVIEW) throw new Error("This file is too large to preview (512 KB limit)")
    const bytes = await Bun.file(target).arrayBuffer()
    if (new Uint8Array(bytes).includes(0)) throw new Error("Binary files cannot be previewed")
    return { content: new TextDecoder().decode(bytes) }
  }
  if (url.pathname === "/api/changes") {
    const raw = await git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."])
    const prefix = (await git(cwd, ["rev-parse", "--show-prefix"])).trim()
    const records = raw.split("\0").filter(Boolean)
    const files = []
    for (let i = 0; i < records.length; i++) {
      const record = records[i]!
      const status = record.slice(0, 2)
      files.push({ status, path: record.slice(3).slice(prefix.length) })
      if (/[RC]/.test(status)) i++
    }
    const branch = (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "Unborn branch")).trim()
    const hasHead = await git(cwd, ["rev-parse", "--verify", "HEAD"]).then(
      () => true,
      () => false,
    )
    const diffArgs = ["--numstat", "--no-ext-diff", "--no-textconv"]
    const stats = hasHead
      ? await git(cwd, ["diff", ...diffArgs, "HEAD", "--", "."])
      : (await git(cwd, ["diff", ...diffArgs, "--cached", "--", "."])) +
        (await git(cwd, ["diff", ...diffArgs, "--", "."]))
    let additions = 0
    let deletions = 0
    for (const line of stats.split("\n")) {
      const [added, removed] = line.split("\t")
      additions += Number(added) || 0
      deletions += Number(removed) || 0
    }
    return { branch, files, additions, deletions }
  }
  // Deleted paths have no realpath; Git only reads paths and runs without external diff helpers.
  const rel = relative(resolve(cwd), resolve(cwd, path))
  if (!path || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Invalid diff path")
  const args = ["--no-ext-diff", "--no-textconv", "--no-color"]
  const hasHead = await git(cwd, ["rev-parse", "--verify", "HEAD"]).then(
    () => true,
    () => false,
  )
  const content = hasHead
    ? await git(cwd, ["diff", ...args, "HEAD", "--", path])
    : (await git(cwd, ["diff", ...args, "--cached", "--", path])) + (await git(cwd, ["diff", ...args, "--", path]))
  return { content: content.slice(0, MAX_PREVIEW), truncated: content.length > MAX_PREVIEW }
}
