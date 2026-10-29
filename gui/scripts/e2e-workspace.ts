import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { projectAdditionalDirectories } from "../server/projects"
import { projectDir } from "../server/sessions"

const root = await mkdtemp(join(tmpdir(), "noa-gui-e2e-"))
const config = await mkdtemp(join(tmpdir(), "noa-gui-e2e-config-"))
const extraSource = await mkdtemp(join(tmpdir(), "noa-gui-e2e-source-"))
const reservation = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() })
const port = reservation.port!
await reservation.stop(true)
const server = Bun.spawn([process.execPath, "run", "server/main.ts"], {
  cwd: resolve(import.meta.dir, ".."),
  env: { ...process.env, NOA_GUI_PORT: String(port), CLAUDE_CONFIG_DIR: config },
  stdout: "ignore",
  stderr: "inherit",
})
const origin = `http://127.0.0.1:${port}`
const previousConfig = process.env.CLAUDE_CONFIG_DIR
let passed = 0
function check(name: string) {
  passed++
  console.log(`PASS ${name}`)
}
async function git(...args: string[]) {
  const proc = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  assert.equal(code, 0, err)
  return out
}
async function request(route: string, path = "", cwd = root, options?: RequestInit) {
  return fetch(`${origin}/api/${route}?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`, options)
}

try {
  for (let attempt = 0; ; attempt++) {
    try {
      await fetch(`${origin}/api/info`)
      break
    } catch {
      if (attempt === 100) throw new Error("Bridge startup timed out")
      await Bun.sleep(50)
    }
  }
  await git("init", "-q")
  await mkdir(join(root, "nested"))
  await writeFile(join(root, "nested", "tracked.txt"), "before\n")
  await writeFile(join(extraSource, "shared.txt"), "shared\n")
  await git("add", ".")
  let body = await (await fetch(`${origin}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: root, sources: [root, extraSource], name: "GUI project" }),
  })).json()
  const project = body.find((candidate: { path: string }) => candidate.path === root)
  assert.equal(project.name, "GUI project")
  assert.deepEqual(project.sources, [root, extraSource])
  process.env.CLAUDE_CONFIG_DIR = config
  assert.deepEqual(projectAdditionalDirectories(root, root), [extraSource])
  check("custom project name and additional source folders persist")
  await fetch(`${origin}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: join(root, "nested"), sources: [join(root, "nested")] }),
  })
  assert.deepEqual(projectAdditionalDirectories(root, join(root, "nested")), [])
  check("nested projects do not inherit an unrelated parent source folder")
  body = await (await fetch(`${origin}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: root, sources: [root], name: "Edited project" }),
  })).json()
  assert.equal(body.find((candidate: { path: string }) => candidate.path === root).name, "Edited project")
  assert.deepEqual(body.find((candidate: { path: string }) => candidate.path === root).sources, [root])
  check("existing projects can update their name and source folders")
  // A repository without HEAD is still a valid workspace.
  body = await (await request("changes")).json()
  assert.equal(body.files[0].status, "A ")
  assert.equal(body.additions, 1)
  check("unborn repository and staged additions")
  await git("-c", "user.name=GUI E2E", "-c", "user.email=gui@example.invalid", "commit", "-qm", "fixture")
  await writeFile(join(root, "nested", "tracked.txt"), "after\nextra\n")
  await writeFile(join(root, "untracked.txt"), "new\n")
  body = await (await request("changes")).json()
  assert.equal(body.files.length, 2)
  // Tracked edit adds 2 and removes 1; the untracked file counts its 1 line as an addition.
  assert.equal(body.additions, 3)
  assert.equal(body.deletions, 1)
  assert.equal(body.files.find((f: { path: string }) => f.path === "untracked.txt").additions, 1)
  check("working tree changes, untracked files and line totals")
  body = await (await request("changes", "", join(root, "nested"))).json()
  assert.equal(body.files[0].path, "tracked.txt")
  check("subdirectory workspace paths")
  body = await (await request("diff", "nested/tracked.txt")).json()
  assert.match(body.content, /\+after/)
  assert.match(body.content, /-before/)
  check("real Git diff")
  await git("add", "nested/tracked.txt")
  await writeFile(join(root, "nested", "tracked.txt"), "x".repeat(600000))
  const stagedUrl = `${origin}/api/diff?${new URLSearchParams({ cwd: root, path: "nested/tracked.txt", scope: "staged" })}`
  const stagedResponse = await fetch(stagedUrl)
  assert.equal(stagedResponse.status, 200, await stagedResponse.text())
  const staged = await (await fetch(stagedUrl)).json()
  assert.match(staged.content, /\+after/)
  await writeFile(join(root, "nested", "tracked.txt"), "y".repeat(600000))
  const changedSnapshot = await (await fetch(stagedUrl)).json()
  assert.notEqual(staged.snapshot, changedSnapshot.snapshot)
  await git("restore", "--staged", "nested/tracked.txt")
  await writeFile(join(root, "nested", "tracked.txt"), "after\nextra\n")
  check("small staged diff remains reviewable with an oversized worktree file")
  body = await (await request("file", "untracked.txt")).json()
  assert.equal(body.content, "new\n")
  check("untracked file preview")
  await git("add", ".")
  await git("mv", "nested/tracked.txt", "nested/renamed file.txt")
  body = await (await request("changes")).json()
  assert(body.files.some((f: { path: string }) => f.path === "nested/renamed file.txt"))
  check("renamed files and spaces")
  assert.equal((await request("file", "../outside.txt")).status, 400)
  assert.equal((await request("file", ".git/config")).status, 400)
  await symlink("/etc/hosts", join(root, "outside-link"))
  assert.equal((await request("file", "outside-link")).status, 400)
  check("traversal, Git metadata and external symlinks rejected")
  await writeFile(join(root, "binary.dat"), new Uint8Array([1, 0, 2]))
  await writeFile(join(root, "large.txt"), "x".repeat(512 * 1024 + 1))
  // Binary files open as a "cannot preview" placeholder; oversized files are still rejected.
  const binary = await request("file", "binary.dat")
  assert.equal(binary.status, 200)
  assert.equal((await binary.json()).kind, "binary")
  assert.equal((await request("file", "large.txt")).status, 400)
  check("binary placeholder and oversized previews rejected")
  body = await (await request("files")).json()
  assert(!body.entries.some((e: { name: string }) => e.name === ".git" || e.name === "outside-link"))
  check("directory listing excludes Git metadata and symlinks")
  // File saves exist now, but only inside listed projects; other write methods stay disallowed.
  assert.equal((await request("file", "outside.txt", config, { method: "POST", body: "{}" })).status, 403)
  assert.equal((await request("file", "untracked.txt", root, { method: "PUT" })).status, 405)
  assert.equal(
    (await request("file", "untracked.txt", root, { headers: { origin: "https://example.invalid" } })).status,
    403,
  )
  check("writes outside listed projects and cross-origin rejected")
  body = await (await request("editors")).json()
  assert(Array.isArray(body.editors))
  for (const editor of body.editors) assert(["vscode", "cursor", "windsurf", "zed"].includes(editor.type) && typeof editor.name === "string")
  assert.deepEqual(body.editors.map((e: { name: string }) => e.name), [...body.editors.map((e: { name: string }) => e.name)].sort((a, b) => a.localeCompare(b)))
  const openIn = (target: string, path: string, cwd = root) => request("open-in", "", cwd, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, target }),
  })
  // Only refusals are exercised here: an accepted request would launch Finder or an editor.
  assert.equal((await request("open-in")).status, 405)
  assert.equal((await openIn("finder", "untracked.txt", config)).status, 403)
  assert.equal((await openIn("finder", "../outside.txt")).status, 400)
  assert.equal((await openIn("finder", ".git/config")).status, 400)
  assert.equal((await openIn("not-an-editor", "untracked.txt")).status, 400)
  check("editor list, and open-in refuses outside paths, Git metadata and unknown editors")
  await mkdir(join(root, "grep"))
  await mkdir(join(root, "node_modules"))
  await writeFile(join(root, "grep", "many.txt"), Array.from({ length: 10 }, (_, i) => `needle ${i}`).join("\n") + "\n")
  await writeFile(join(root, "grep", "upper.txt"), "a Needle here\n")
  await writeFile(join(root, "node_modules", "dep.txt"), "needle in a dependency\n")
  const grep = async (q: string, max = 241) => (await (await fetch(`${origin}/api/grep?${new URLSearchParams({ cwd: root, q, max: String(max) })}`)).json()).matches as { path: string; line: number; preview: string }[]
  let hits = await grep("needle")
  const perFile = (list: typeof hits) => list.reduce((counts, hit) => counts.set(hit.path, (counts.get(hit.path) ?? 0) + 1), new Map<string, number>())
  assert.equal(perFile(hits).get("grep/many.txt"), 6)
  assert.equal(perFile(hits).get("grep/upper.txt"), 1)
  assert(!hits.some((hit) => hit.path.startsWith("node_modules/")))
  assert.deepEqual(hits.filter((hit) => hit.path === "grep/many.txt").map((hit) => hit.line), [1, 2, 3, 4, 5, 6])
  hits = await grep("Needle")
  assert.deepEqual(hits.map((hit) => hit.path), ["grep/upper.txt"])
  hits = await grep("needle", 3)
  assert(hits.length >= 3 && hits.length <= 3 + 5)
  for (const count of perFile(hits).values()) assert(count <= 6)
  assert.deepEqual(await grep("   "), [])
  check("content search: smart case, 6 per file, cap finishes the current file, node_modules skipped")
  const branchState = async () => (await (await request("branches")).json()) as { isGit: boolean; current: string; branches: string[]; uncommitted: number; hasCommits: boolean }
  const branchAction = (action: string, branch: string, cwd = root) => request("branches", "", cwd, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, branch }),
  })
  const start = await branchState()
  const home = (await git("branch", "--show-current")).trim()
  assert(start.isGit && start.hasCommits && start.current === home && start.branches[0] === home)
  assert(start.uncommitted > 0)
  // Creating a branch carries the uncommitted work along, as `git switch -c` does.
  assert.equal((await branchAction("create", "feature/menu")).status, 200)
  assert.equal((await branchState()).current, "feature/menu")
  assert.equal((await (await branchAction("create", "feature/menu")).json()).error, "Branch already exists.")
  assert.equal((await (await branchAction("create", "feature/")).json()).error, "Branch name cannot end with “/”.")
  assert.equal((await branchAction("create", "-x")).status, 400)
  assert.equal((await branchAction("create", "two words")).status, 400)
  // Switching away from uncommitted tracked changes is refused until they are committed.
  assert.match((await (await branchAction("checkout", home)).json()).error, /^Commit changes in \d+ files? to check out /)
  assert.equal((await branchState()).current, "feature/menu")
  assert.equal((await branchAction("checkout", home, config)).status, 403)
  assert.equal((await branchAction("checkout", "no-such-branch")).status, 400)
  await git("-c", "user.name=GUI E2E", "-c", "user.email=gui@example.invalid", "commit", "-qam", "branch fixture")
  assert.equal((await branchAction("checkout", home)).status, 200)
  assert.equal((await git("branch", "--show-current")).trim(), home)
  check("branch switcher: list, create, refuse invalid names, uncommitted guard, listed projects only")
  const sessionId = crypto.randomUUID()
  const sessions = projectDir(root)
  await mkdir(sessions, { recursive: true })
  await writeFile(
    join(sessions, `${sessionId}.jsonl`),
    [
      { type: "user", timestamp: "2026-01-02T03:04:05.000Z", message: { content: "Original task instruction with a long path" } },
      { type: "custom-title", customTitle: "Existing task name", sessionId },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
  )
  body = await (await request("sessions")).json()
  assert.equal(body[0].title, "Existing task name")
  assert.equal(body[0].createdAt, Date.parse("2026-01-02T03:04:05.000Z"))
  assert(body[0].updatedAt > body[0].createdAt)
  check("existing task title and start time metadata are used")
  let response = await request(`sessions/${sessionId}`, "", root, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Renamed task" }),
  })
  assert.equal(response.status, 200)
  body = await response.json()
  assert.equal(body[0].title, "Renamed task")
  body = await (await request(`sessions/${sessionId}`)).json()
  assert.equal(body[0].text, "Original task instruction with a long path")
  check("rename persists without changing task instructions")
  response = await request(`sessions/${sessionId}`, "", root, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: " " }),
  })
  assert.equal(response.status, 400)
  check("empty task names rejected")
  console.log(`${passed} workspace E2E scenarios passed`)
} finally {
  server.kill()
  await server.exited
  if (previousConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousConfig
  await rm(root, { recursive: true, force: true })
  await rm(config, { recursive: true, force: true })
  await rm(extraSource, { recursive: true, force: true })
}
