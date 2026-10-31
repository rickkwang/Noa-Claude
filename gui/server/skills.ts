// Settings-page skill management: on/off through the CLI's `skillModes` setting, plus reading, revealing and
// removing skills that live under the user's own skills folder. Other skills (bundled, plugin, project) are
// reported but never touched here.
import { existsSync } from "node:fs"
import { lstat, readFile, readdir, realpath, rename, rm, unlink, writeFile } from "node:fs/promises"
import { join, sep } from "node:path"
import { getClaudeConfigHomeDir } from "../../src/utils/envUtils"

const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

function configHome(): string {
  return getClaudeConfigHomeDir()
}

function skillsRoot(): string {
  return join(configHome(), "skills")
}

type UserSkill = { name: string; dir: string; description: string }

// Handles `description: text` and the folded/literal block forms (`>`, `|`) that long descriptions use.
function frontmatterDescription(front: string): string {
  const lines = front.split(/\r?\n/)
  const at = lines.findIndex((line) => /^description:/.test(line))
  if (at < 0) return ""
  const inline = lines[at]!.replace(/^description:\s*/, "").trim()
  if (inline && !/^[>|][+-]?$/.test(inline)) return inline.replace(/^["']|["']$/g, "")
  const block: string[] = []
  for (const line of lines.slice(at + 1)) {
    if (line.trim() && !/^\s/.test(line)) break
    block.push(line.trim())
  }
  return block.filter(Boolean).join(" ")
}

// A skill's command name is its frontmatter `name`, falling back to the folder name.
async function listUserSkills(): Promise<UserSkill[]> {
  let entries: string[]
  try {
    entries = await readdir(skillsRoot())
  } catch {
    return []
  }
  const found: UserSkill[] = []
  for (const entry of entries) {
    const dir = join(skillsRoot(), entry)
    let text: string
    try {
      text = await readFile(join(dir, "SKILL.md"), "utf8")
    } catch {
      continue
    }
    const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ""
    const declared = front.match(/^name:\s*["']?([^\r\n"']+)["']?\s*$/m)?.[1]?.trim()
    found.push({ name: declared || entry, dir, description: frontmatterDescription(front) })
  }
  return found
}

async function readSettings(): Promise<{ file: string; data: Record<string, unknown> }> {
  const link = join(configHome(), "settings.json")
  if (!existsSync(link)) return { file: link, data: {} }
  const file = await realpath(link)
  const parsed = JSON.parse(await readFile(file, "utf8")) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("settings.json is not a JSON object.")
  return { file, data: parsed as Record<string, unknown> }
}

async function readModes(): Promise<Record<string, string>> {
  try {
    const modes = (await readSettings()).data.skillModes
    return modes && typeof modes === "object" ? (modes as Record<string, string>) : {}
  } catch {
    return {}
  }
}

// Toggles can arrive back to back; each read-modify-write waits for the one before it.
let writeQueue: Promise<unknown> = Promise.resolve()
let tempCounter = 0

function writeMode(name: string, mode: "on" | "off"): Promise<void> {
  const run = writeQueue.then(() => writeModeNow(name, mode))
  writeQueue = run.catch(() => {})
  return run
}

async function writeModeNow(name: string, mode: "on" | "off"): Promise<void> {
  const { file, data } = await readSettings()
  const modes = { ...((data.skillModes as Record<string, string> | undefined) ?? {}) }
  // "on" is the default for a skill, so enabling just drops the override.
  if (mode === "off") modes[name] = "off"
  else delete modes[name]
  if (Object.keys(modes).length) data.skillModes = modes
  else delete data.skillModes
  const temp = `${file}.${process.pid}.${tempCounter++}.tmp`
  await writeFile(temp, JSON.stringify(data, null, 2) + "\n")
  await rename(temp, file)
}

export async function skillsState(): Promise<{ modes: Record<string, string>; userSkills: { name: string; description: string }[] }> {
  const skills = await listUserSkills()
  return { modes: await readModes(), userSkills: skills.map(({ name, description }) => ({ name, description })) }
}

export async function skillAction(body: unknown): Promise<{ status: number; body: unknown }> {
  const { action, name, mode } = (body ?? {}) as { action?: unknown; name?: unknown; mode?: unknown }
  if (typeof name !== "string" || !NAME.test(name)) return { status: 400, body: { error: "Invalid skill name." } }
  try {
    if (action === "mode") {
      if (mode !== "on" && mode !== "off") return { status: 400, body: { error: "Invalid mode." } }
      await writeMode(name, mode)
      return { status: 200, body: { ok: true } }
    }
    const matches = (await listUserSkills()).filter((candidate) => candidate.name === name)
    if (matches.length > 1 && action !== "mode") return { status: 409, body: { error: "More than one skill folder uses this name. Rename one of them first." } }
    const skill = matches[0]
    if (action === "read") {
      if (!skill) return { status: 404, body: { error: "This skill's file is not available." } }
      return { status: 200, body: { content: await readFile(join(skill.dir, "SKILL.md"), "utf8") } }
    }
    if (action === "reveal") {
      if (!skill) return { status: 404, body: { error: "This skill's file is not available." } }
      const reveal = Bun.spawn(["open", "-R", join(skill.dir, "SKILL.md")], { stdout: "ignore", stderr: "ignore" })
      if ((await reveal.exited) !== 0) return { status: 400, body: { error: "Could not reveal the skill in Finder." } }
      return { status: 200, body: { ok: true } }
    }
    if (action === "uninstall") {
      if (!skill || !skill.dir.startsWith(skillsRoot() + sep)) return { status: 404, body: { error: "Only skills in your own skills folder can be uninstalled." } }
      // A linked skill folder is removed as the link; its target is left alone.
      if ((await lstat(skill.dir)).isSymbolicLink()) await unlink(skill.dir)
      else await rm(skill.dir, { recursive: true })
      // The override would otherwise linger and silently disable a skill reinstalled later under the same name.
      // The folder is already gone, so a settings problem here must not report the uninstall as failed.
      await writeMode(name, "on").catch(() => {})
      return { status: 200, body: { ok: true } }
    }
  } catch (e) {
    return { status: 400, body: { error: e instanceof Error ? e.message : String(e) } }
  }
  return { status: 400, body: { error: "Unknown action." } }
}
