import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { AgentState } from "../agent/reducer"
import { fetchPlugins, fetchSkillsState, runPluginAction, runSkillAction, type SkillsState, type PluginAction, type PluginCatalog } from "../api"
import { ArrowUpDown, Check, ChevronDown, ChevronLeft, Download, Plug, Plus, Search, Trash2, X } from "../lib/icons"
import { useFlash } from "../hooks/useActionFeedback"
import { useConfirm } from "./ConfirmDialog"
import { Markdown } from "./Markdown"
import { Row, Section, Toggle } from "./settings/controls"
import { mcpActionStatus, mcpReconnected, sourceLabels } from "./settings/ConfigurationPages"

type PluginsTab = "plugins" | "skills" | "connectors" | "marketplace"
type SkillCommand = AgentState["commands"][number]

const outlineButton = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 text-chat-sm hover:bg-[var(--settings-fill-hover)] disabled:opacity-40"
const primaryButton = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--text-primary)] px-2.5 text-chat-sm font-medium text-[var(--surface-page,#FFFFFF)] hover:opacity-90 disabled:opacity-40"
const iconButton = "inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-[var(--sidebar-text-muted)] hover:bg-[var(--settings-fill-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
const tileClass = "flex size-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)] text-[var(--text-secondary)]"
const PAGE_SIZE = 40
const cardClass = "rounded-2xl bg-[color-mix(in_srgb,var(--text-primary)_4%,transparent)] transition-colors hover:bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)]"

function CubeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d="M12 3 19.5 7.2v8.6L12 20l-7.5-4.2V7.2L12 3Z" />
      <path d="M4.5 7.2 12 11.5l7.5-4.3M12 11.5V20" />
    </svg>
  )
}
// Marketplaces that are a local folder or file have no remote to pull from.
const LOCAL_SOURCES = new Set(["directory", "file"])
const SKILL_SOURCE_LABELS: Record<string, string> = { userSettings: "Personal", projectSettings: "Project", localSettings: "Project", bundled: "System", builtin: "System", mcp: "MCP" }

const titleCase = (name: string) => (name.split(":").pop() ?? name).split(/[-_\s]+/).filter(Boolean).map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ")

// Skills that ship inside Noa cannot be switched off or removed from here.
const SYSTEM_SKILL_SOURCES = new Set(["bundled", "builtin", "mcp"])

function skillBody(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()
}

export function CustomizePage({ skills: promptCommands, mcpServers, mcpAction, mcpLocked, onChangeMcp, onReloadCommands, onOpenMcp, onTrySkill }: { skills: SkillCommand[]; mcpServers?: AgentState["mcpServers"]; mcpAction?: AgentState["mcpAction"]; mcpLocked: boolean; onChangeMcp: (name: string, enabled?: boolean) => void; onReloadCommands: () => void; onOpenMcp: () => void; onTrySkill: (name: string) => void }) {
  const { confirm, dialog } = useConfirm()
  const [catalog, setCatalog] = useState<PluginCatalog>()
  const [loadError, setLoadError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [notice, flashNotice] = useFlash<string>()
  const [upgraded, flashUpgraded] = useFlash<string>()
  const [tab, setTab] = useState<PluginsTab>("skills")
  const [descending, setDescending] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [detail, setDetail] = useState<string>()
  const [filter, setFilter] = useState("")
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [menuOpen, setMenuOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  // Enabled flags the user just flipped, shown until the CLI confirms them.
  const [pendingEnabled, setPendingEnabled] = useState<Record<string, boolean>>({})
  const [skillsState, setSkillsState] = useState<SkillsState>({ modes: {}, userSkills: [] })
  const [skillName, setSkillName] = useState<string>()
  const [skillText, setSkillText] = useState<string>()
  const [skillMenu, setSkillMenu] = useState(false)
  const [rowMenu, setRowMenu] = useState<string>()
  const [source, setSource] = useState("")
  const [sparse, setSparse] = useState("")
  const sourceRef = useRef<HTMLDivElement>(null)
  const [sourceThumb, setSourceThumb] = useState<{ left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const root = sourceRef.current
    if (!root || detail !== undefined || tab !== "plugins") return
    const measure = () => {
      const active = root.querySelector<HTMLElement>("[aria-selected=true]")
      setSourceThumb(active ? { left: active.offsetLeft, width: active.offsetWidth } : null)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [tab, browsing, detail])

  const load = () => fetchPlugins().then((next) => { setCatalog(next); setLoadError(undefined) }, (e: Error) => setLoadError(e.message))
  useEffect(() => { void load() }, [])
  const loadSkills = () => fetchSkillsState().then(setSkillsState, () => {})
  useEffect(() => { void loadSkills() }, [])
  const removable = skillsState.userSkills.map((skill) => skill.name)
  // A skill that is switched off disappears from the CLI's command list, so the user's own ones are added back.
  const known = new Set(promptCommands.map((command) => command.name))
  const merged: SkillCommand[] = [
    ...promptCommands.filter((command) => !command.hidden),
    ...skillsState.userSkills.filter((skill) => !known.has(skill.name)).map((skill): SkillCommand => ({ name: skill.name, description: skill.description, argumentHint: "", type: "prompt", source: "userSettings" })),
  ]
  // Switching a skill off moves it from the command list to the appended ones; keeping each skill at the
  // place it was first shown stops the row from jumping to the bottom.
  const skillOrder = useRef(new Map<string, number>())
  for (const command of merged) if (!skillOrder.current.has(command.name)) skillOrder.current.set(command.name, skillOrder.current.size)
  const skills = [...merged].sort((a, b) => skillOrder.current.get(a.name)! - skillOrder.current.get(b.name)!)
  const skillOff = (name: string) => skillsState.modes[name] === "off"
  // A switched-off skill is only recoverable here when it is listed from the user's own folder.
  const switchable = (command: SkillCommand) => !SYSTEM_SKILL_SOURCES.has(command.source ?? "") && removable.includes(command.name)
  const currentSkill = skills.find((command) => command.name === skillName)
  const ownsSkill = skillName !== undefined && removable.includes(skillName)

  useEffect(() => {
    setSkillText(undefined)
    setSkillMenu(false)
    if (!skillName || !ownsSkill) return
    let stale = false
    runSkillAction("read", skillName).then((result) => { if (!stale) setSkillText(result.content) }, () => {})
    return () => { stale = true }
  }, [skillName, ownsSkill])

  // Close inner overlays/views on Escape before App.tsx closes the whole Customize page.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (skillMenu) { setSkillMenu(false); event.stopPropagation(); event.preventDefault(); return }
      if (skillName !== undefined) { setSkillName(undefined); event.stopPropagation(); event.preventDefault(); return }
      if (rowMenu !== undefined) { setRowMenu(undefined); event.stopPropagation(); event.preventDefault(); return }
      if (menuOpen) { setMenuOpen(false); event.stopPropagation(); event.preventDefault(); return }
      if (adding) { setAdding(false); setError(undefined); event.stopPropagation(); event.preventDefault(); return }
      if (detail !== undefined) { setDetail(undefined); setError(undefined); event.stopPropagation(); event.preventDefault() }
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [skillMenu, skillName, rowMenu, menuOpen, adding, detail])

  // The switch moves at once; the file write and the command reload catch up behind it.
  const setSkillMode = async (name: string, enabled: boolean) => {
    setError(undefined)
    setSkillsState((current) => {
      const modes = { ...current.modes }
      if (enabled) delete modes[name]
      else modes[name] = "off"
      return { ...current, modes }
    })
    try {
      await runSkillAction("mode", name, enabled ? "on" : "off")
      onReloadCommands()
    } catch (e) {
      setError(`Failed to update skill\n${e instanceof Error ? e.message : String(e)}`)
    }
    await loadSkills()
  }

  const uninstallSkill = async (name: string) => {
    if (!(await confirm({
      title: `Uninstall ${titleCase(name)}?`,
      description: "This deletes the skill's folder from your skills directory.",
      confirmLabel: "Uninstall",
      danger: true,
    }))) return
    setError(undefined)
    try {
      await runSkillAction("uninstall", name)
      setSkillName(undefined)
      await loadSkills()
      onReloadCommands()
    } catch (e) {
      setError(`Failed to uninstall skill\n${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // A failure shows the CLI's message under a summary line; success reloads the catalog and the slash commands.
  const run = async (key: string, action: PluginAction, target?: string, extra?: string, failure?: string, scope?: string) => {
    setBusy(key)
    setError(undefined)
    try {
      await runPluginAction(action, target, extra, scope)
      await load()
      if (action === "install" || action === "uninstall" || action === "enable" || action === "disable") onReloadCommands()
      return true
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(failure ? `${failure}\n${message}` : message)
      return false
    } finally {
      setBusy(undefined)
    }
  }

  const available = catalog?.available ?? []
  const byId = new Map(available.map((plugin) => [plugin.pluginId, plugin]))
  const installed = (catalog?.installed ?? []).map((plugin) => {
    const [name = plugin.id, marketplace] = plugin.id.split("@")
    return { ...plugin, name, marketplace, enabled: pendingEnabled[plugin.id] ?? plugin.enabled, description: plugin.description ?? byId.get(plugin.id)?.description }
  })
  const installedById = new Map(installed.map((plugin) => [plugin.id, plugin]))
  const needle = filter.trim().toLowerCase()
  const match = (text: string) => !needle || text.toLowerCase().includes(needle)
  const marketplaces = (catalog?.marketplaces ?? []).filter((market) => match(market.name))
  const order = <T,>(items: T[], name: (item: T) => string) => [...items].sort((a, b) => name(a).localeCompare(name(b)) * (descending ? -1 : 1))
  const tabs: [PluginsTab, string][] = [["skills", "Skills"], ["connectors", "Connectors"], ["plugins", "Plugins"]]
  const busyAny = busy !== undefined

  // Plugins installed for a session only cannot be changed from here.
  const manageable = (plugin: { scope: string }) => ["user", "project", "local"].includes(plugin.scope)

  const setPluginEnabled = async (id: string, enabled: boolean, scope: string) => {
    setPendingEnabled((current) => ({ ...current, [id]: enabled }))
    await run(`toggle:${id}`, enabled ? "enable" : "disable", id, undefined, undefined, scope)
    setPendingEnabled(({ [id]: _settled, ...rest }) => rest)
  }

  const uninstall = (id: string, name: string, scope: string) => run(`uninstall:${id}`, "uninstall", id, undefined, `Unable to uninstall ${name}. Retry to continue`, scope)

  const removeMarketplace = async (name: string) => {
    const affected = installed.filter((plugin) => plugin.marketplace === name)
    if (!(await confirm({
      title: `Remove "${name}"?`,
      description: affected.length ? (
        <>
          The following plugins will be uninstalled, and can't be re-installed unless you add this marketplace again.
          <span className="mt-2 block font-medium">{affected.map((plugin) => plugin.name).join(", ")}</span>
        </>
      ) : "Its plugins will not appear or be available for installation unless you add it again.",
      confirmLabel: affected.length ? "Uninstall & remove" : "Remove",
      danger: true,
    }))) return
    setBusy(`remove:${name}`)
    setError(undefined)
    try {
      for (const plugin of affected) await runPluginAction("uninstall", plugin.id, undefined, plugin.scope)
      await runPluginAction("marketplace-remove", name)
    } catch (e) {
      setError(`Unable to remove the marketplace. Some of its plugins may already be uninstalled. Retry to continue\n${e instanceof Error ? e.message : String(e)}`)
    } finally {
      // Whatever was uninstalled before a failure still has to leave the command list.
      await load()
      onReloadCommands()
      setBusy(undefined)
    }
  }

  // One card: 40px tile, name over a two-line description and a muted meta line, control at the top right.
  const row = (id: string, name: string, muted: string | undefined, description: string | undefined, control: ReactNode, opts: { onOpen?: () => void; round?: boolean; tile?: ReactNode } = {}) => (
    <div key={id} data-plugin={id} className={`flex items-start gap-3 p-3.5 ${cardClass}`}>
      <button type="button" disabled={!opts.onOpen} onClick={opts.onOpen} className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:cursor-default">
        <span className={tileClass}>{opts.tile ?? <CubeIcon />}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-chat-sm font-medium leading-[18px] text-[var(--text-primary)]">{name}</span>
          {description && <span className="mt-0.5 line-clamp-2 text-caption leading-[17px] text-[var(--sidebar-text-muted)]">{description}</span>}
          {muted && <span className="mt-1 block truncate text-caption leading-4 text-[var(--sidebar-text-muted)]">{muted}</span>}
        </span>
      </button>
      {control}
    </div>
  )

  const installControl = (id: string, name: string) => installedById.has(id)
    ? <span aria-label="Installed" className="flex size-8 shrink-0 items-center justify-center text-[var(--sidebar-text-muted)]"><Check size={16} /></span>
    : <button type="button" aria-label={`Install ${name}`} title="Install" className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--sidebar-text-muted)] hover:bg-[var(--settings-fill-hover)] hover:text-[var(--text-primary)] disabled:opacity-40" disabled={busyAny} onClick={() => run(`install:${id}`, "install", id, undefined, `Unable to install ${name}.`)}>
        {busy === `install:${id}` ? <span className="text-caption">…</span> : <Plus size={16} />}
      </button>

  const open = (id: string) => { setDetail(id); setError(undefined) }
  const empty = (title: string, hint?: string) => (
    <div className="flex flex-col items-center gap-1 py-16 text-center">
      <span className="text-body text-[var(--text-primary)]">{title}</span>
      {hint && <span className="text-body text-[var(--sidebar-text-muted)]">{hint}</span>}
    </div>
  )
  const flat = (rows: ReactNode[]) => <div className="mt-2 flex flex-col">{rows}</div>
  const grid = (rows: ReactNode[]) => <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{rows}</div>

  let body: ReactNode
  if (detail) {
    const entry = installedById.get(detail)
    const listing = byId.get(detail)
    const name = entry?.name ?? listing?.name ?? detail.split("@")[0] ?? detail
    const marketplace = entry?.marketplace ?? listing?.marketplaceName
    const servers = Object.keys(entry?.mcpServers ?? {})
    const origin = listing?.source && typeof listing.source === "object" ? (listing.source.url ?? listing.source.repo ?? listing.source.path) : undefined
    body = (
      <>
        <div className="flex items-center gap-3">
          <span className={`${tileClass} !size-12 rounded-xl`}><CubeIcon size={22} /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[18px] leading-6">{name}</span>
            {marketplace && <span className="block truncate text-body text-[var(--sidebar-text-muted)]">{marketplace}</span>}
          </span>
          {entry ? (manageable(entry) ? (
            <span className="flex shrink-0 items-center gap-3">
              <Toggle checked={entry.enabled} label={entry.enabled ? "Disable plugin" : "Enable plugin"} onChange={(enabled) => void setPluginEnabled(entry.id, enabled, entry.scope)} />
              <button type="button" className={outlineButton} disabled={busyAny} onClick={() => uninstall(entry.id, name, entry.scope)}>
                {busy === `uninstall:${entry.id}` ? "Uninstalling…" : "Uninstall"}
              </button>
            </span>
          ) : null) : installControl(detail, name)}
        </div>
        {(entry?.description ?? listing?.description) && <p className="noa-selectable m-0 text-body leading-[22px]">{entry?.description ?? listing?.description}</p>}
        <Section title="Information">
          {marketplace && <Row label="Marketplace"><span className="text-body text-[var(--sidebar-text-muted)]">{marketplace}</span></Row>}
          {entry && <Row label="Version"><span className="text-body text-[var(--sidebar-text-muted)]">{entry.version}</span></Row>}
          {entry && <Row label="Scope"><span className="text-body capitalize text-[var(--sidebar-text-muted)]">{entry.scope}</span></Row>}
          {listing?.installCount !== undefined && <Row label="Installs"><span className="text-body text-[var(--sidebar-text-muted)]">{listing.installCount.toLocaleString()}</span></Row>}
          {entry?.homepage && <Row label="Website"><span className="noa-selectable max-w-[22rem] truncate text-body text-[var(--sidebar-text-muted)]">{entry.homepage}</span></Row>}
          {origin && <Row label="Source"><span className="noa-selectable max-w-[22rem] truncate text-body text-[var(--sidebar-text-muted)]">{origin}</span></Row>}
        </Section>
        {servers.length > 0 && (
          <Section title="Capabilities">
            {servers.map((server) => <Row key={server} label={server} description="MCP server" />)}
          </Section>
        )}
      </>
    )
  } else if (!catalog && (tab === "plugins" || tab === "marketplace")) {
    body = loadError
      ? <div className="flex flex-col items-center gap-3 py-16 text-center"><span className="text-body">Failed to load plugins</span><span className="text-body text-[var(--sidebar-text-muted)]">{loadError}</span><button type="button" className={outlineButton} onClick={() => { setLoadError(undefined); void load() }}>Retry</button></div>
      : empty("Loading plugins…")
  } else if (browsing && tab === "plugins") {
    // The CLI's available list leaves out what is installed, so fold those back in.
    const directory = [
      ...installed.map((plugin) => ({ pluginId: plugin.id, name: plugin.name, description: plugin.description })),
      ...available,
    ].sort((a, b) => a.name.localeCompare(b.name))
    const matches = order(directory.filter((plugin) => match(`${plugin.name} ${plugin.description ?? ""}`)), (plugin) => plugin.name)
    body = (
      <>
        {matches.length
          ? grid(matches.slice(0, limit).map((plugin) => row(plugin.pluginId, plugin.name, undefined, plugin.description, installControl(plugin.pluginId, plugin.name), { onOpen: () => open(plugin.pluginId) })))
          : empty(directory.length ? "No matching plugins" : "No plugins available", directory.length ? undefined : "Add a marketplace to browse plugins.")}
        {matches.length > limit && <button type="button" className={`${outlineButton} mt-3 self-center`} onClick={() => setLimit((value) => value + PAGE_SIZE)}>Load more</button>}
      </>
    )
  } else if (tab === "plugins") {
    const list = order(installed.filter((plugin) => match(`${plugin.name} ${plugin.description ?? ""}`)), (plugin) => plugin.name)
    body = list.length ? grid(list.map((plugin) => row(
      plugin.id, plugin.name, plugin.marketplace, plugin.description,
      manageable(plugin) ? <Toggle checked={plugin.enabled} label={plugin.enabled ? "Disable plugin" : "Enable plugin"} onChange={(enabled) => void setPluginEnabled(plugin.id, enabled, plugin.scope)} /> : null,
      { onOpen: () => open(plugin.id) },
    ))) : empty(installed.length ? "No matching plugins" : "No installed plugins", installed.length ? undefined : "Switch to Discover to install one.")
  } else if (tab === "skills") {
    const list = order(skills.filter((command) => match(`${command.name} ${command.description ?? ""}`)), (command) => titleCase(command.name))
    body = list.length ? grid(list.map((command) => {
      const description = command.rawDescription ?? command.description
      const off = skillOff(command.name)
      const own = removable.includes(command.name)
      const menuOpen = rowMenu === command.name
      const sourceLabel = command.source ? (SKILL_SOURCE_LABELS[command.source] ?? sourceLabels[command.source] ?? command.source) : ""
      return (
        <div key={command.name} data-skill={command.name} className={`group relative flex items-start gap-3 p-3.5 ${cardClass}`}>
          <button type="button" onClick={() => setSkillName(command.name)} className={`flex min-w-0 flex-1 items-start gap-3 text-left ${off ? "opacity-60" : ""}`}>
            <span className={tileClass}><CubeIcon /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-chat-sm font-medium leading-[18px] text-[var(--text-primary)]">{titleCase(command.name)}</span>
              <span className="mt-0.5 line-clamp-2 text-caption leading-[17px] text-[var(--sidebar-text-muted)]">{description}</span>
              {sourceLabel && <span className="mt-1 block truncate text-caption leading-4 text-[var(--sidebar-text-muted)]">{sourceLabel}</span>}
            </span>
          </button>
          <span className="relative flex shrink-0 items-center gap-1">
            <span className={`transition-opacity focus-within:opacity-100 group-hover:opacity-100 ${menuOpen ? "opacity-100" : "opacity-0"}`}>
              <button type="button" aria-label="Skill actions" aria-haspopup="menu" aria-expanded={menuOpen} className={iconButton} onClick={() => setRowMenu(menuOpen ? undefined : command.name)}>
                <span aria-hidden="true" className="px-0.5 text-body leading-none">•••</span>
              </button>
            </span>
            {switchable(command) && <Toggle checked={!off} label={off ? "Enable skill" : "Disable skill"} onChange={(enabled) => void setSkillMode(command.name, enabled)} />}
            {menuOpen && (
              <>
                <button type="button" aria-label="Close menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setRowMenu(undefined)} />
                <div role="menu" className="noa-floating-panel absolute right-0 top-full z-20 mt-1 flex min-w-44 flex-col rounded-[var(--menu-popover-radius)] bg-[var(--bg-card)] p-1 shadow-[var(--menu-shadow)]">
                  <button type="button" role="menuitem" className="h-8 rounded-lg px-2.5 text-left text-body hover:bg-[var(--settings-fill-hover)]" onClick={() => { setRowMenu(undefined); setSkillName(command.name) }}>Details</button>
                  {own && (
                    <>
                      <button type="button" role="menuitem" className="h-8 rounded-lg px-2.5 text-left text-body hover:bg-[var(--settings-fill-hover)]" onClick={() => { setRowMenu(undefined); void runSkillAction("reveal", command.name).catch((e: Error) => setError(e.message)) }}>Reveal in Finder</button>
                      <button type="button" role="menuitem" className="h-8 rounded-lg px-2.5 text-left text-body hover:bg-[var(--settings-fill-hover)]" onClick={() => { setRowMenu(undefined); void runSkillAction("read", command.name).then((result) => navigator.clipboard.writeText(result.content ?? "")).then(() => flashNotice("Copied Markdown"), (e: Error) => setError(e.message)) }}>Copy Markdown</button>
                      <button type="button" role="menuitem" className="h-8 rounded-lg px-2.5 text-left text-body text-[#C24444] hover:bg-[var(--settings-fill-hover)]" onClick={() => { setRowMenu(undefined); void uninstallSkill(command.name) }}>Uninstall</button>
                    </>
                  )}
                </div>
              </>
            )}
          </span>
        </div>
      )
    })) : empty(skills.length ? "No matching skills" : "No skills available")
  } else if (tab === "connectors") {
    const list = order((mcpServers ?? []).filter((server) => match(server.name)), (server) => server.name)
    const statusLabel: Record<string, string> = { connected: "Connected", failed: "Failed to connect", "needs-auth": "Needs authentication", pending: "Connecting…", disabled: "Disabled" }
    body = list.length ? grid(list.map((server) => {
      const action = mcpActionStatus(mcpAction, server.name)
      const status = action?.label ?? statusLabel[server.status] ?? server.status
      return (
        <div key={server.name} data-connector={server.name} className={`flex items-start gap-3 p-3.5 ${cardClass}`}>
          <span className={tileClass}><Plug size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-chat-sm font-medium leading-[18px] text-[var(--text-primary)]">{server.name}</span>
            <span role="status" title={action?.failed ? status : undefined} className={`mt-0.5 block truncate text-caption leading-[17px] ${action?.failed ? "text-[var(--text-danger)]" : "text-[var(--sidebar-text-muted)]"}`}>{status}</span>
          </span>
          {server.status !== "disabled" && server.status !== "pending" && <button type="button" className={outlineButton} disabled={mcpLocked} onClick={() => onChangeMcp(server.name)}>{mcpReconnected(mcpAction, server.name) ? <><Check size={14} />Reconnected</> : "Reconnect"}</button>}
          <Toggle checked={server.status !== "disabled"} label={server.status === "disabled" ? "Enable connector" : "Disable connector"} onChange={(enabled) => onChangeMcp(server.name, enabled)} />
        </div>
      )
    })) : empty(mcpServers ? (needle ? "No matching connectors" : "No connectors") : "Loading connectors…", mcpServers && !needle ? "Use Add → MCP server to connect one." : undefined)
  } else {
    body = marketplaces.length ? flat(marketplaces.map((market) => {
      const local = LOCAL_SOURCES.has(market.source)
      return (
        <div key={market.name} className="flex items-center gap-3.5 px-2 py-3.5">
          <span className={`${tileClass} rounded-xl !border-transparent !bg-[var(--settings-fill-hover)]`}><Download size={18} /></span>
          <span className="min-w-0 flex-1 pr-8">
            <span className="block truncate text-body leading-[22px] text-[var(--text-primary)]">{market.name}</span>
            <span className="block text-body leading-[22px] text-[var(--sidebar-text-muted)]">{available.filter((plugin) => plugin.marketplaceName === market.name).length} plugins</span>
            <span className="block truncate text-body leading-[22px] text-[var(--sidebar-text-muted)]">{market.repo ?? market.url ?? market.path ?? market.installLocation ?? market.source}</span>
          </span>
          <button
            type="button"
            className={outlineButton}
            title={local ? "Only Git marketplaces can be upgraded" : undefined}
            disabled={busyAny || local}
            onClick={() => void run(`update:${market.name}`, "marketplace-update", market.name, undefined, "Unable to upgrade the marketplace.").then((ok) => { if (ok) flashUpgraded(market.name) })}
          >
            {busy === `update:${market.name}` ? "Upgrading…" : upgraded === market.name ? <><Check size={14} />Upgraded</> : "Upgrade"}
          </button>
          <button type="button" aria-label={`Remove ${market.name}`} title="Remove marketplace" className={iconButton} disabled={busyAny} onClick={() => void removeMarketplace(market.name)}>
            <Trash2 size={17} />
          </button>
        </div>
      )
    })) : empty(catalog?.marketplaces.length ? "No matching marketplaces" : "No marketplaces found", catalog?.marketplaces.length ? undefined : "Add one to browse and install plugins.")
  }

  const inDetail = detail !== undefined
  const marketView = tab === "marketplace"
  const menuItem = "h-8 rounded-lg px-2.5 text-left text-body hover:bg-[var(--settings-fill-hover)]"
  return (
    <>
      <h1 className="m-0 noa-serif text-[26px] leading-8 text-[var(--text-primary)]">Customize</h1>
      {(inDetail || marketView) && (
        <button type="button" className="-mt-2 inline-flex items-center gap-1 self-start text-chat-sm text-[var(--sidebar-text-muted)] hover:text-[var(--text-primary)]" onClick={() => { if (inDetail) setDetail(undefined); else { setTab("plugins"); setBrowsing(true); setFilter("") } }}>
          <ChevronLeft size={14} />
          {inDetail ? (marketView ? "Marketplaces" : browsing ? "Discover" : "Plugins") : "Plugins"}
        </button>
      )}
      {!inDetail && (
        <div className="flex flex-wrap items-center gap-1.5">
          {!marketView && (
            <>
              <div className="flex items-center gap-0.5" role="tablist">
                {tabs.map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setBrowsing(false); setFilter(""); setAdding(false); setError(undefined); setRowMenu(undefined) }} className={`h-7 rounded-lg px-2.5 text-chat-sm font-medium transition-colors ${tab === key ? "bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)] text-[var(--text-primary)]" : "text-[var(--sidebar-text-muted)] hover:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)] hover:text-[var(--text-primary)]"}`}>{label}</button>
                ))}
              </div>
              {tab === "plugins" && (
                <>
                  <span aria-hidden="true" className="mx-1 h-4 w-px bg-[var(--border-default)]" />
                  <div ref={sourceRef} className="relative inline-flex h-7 shrink-0 items-stretch rounded-lg bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)] p-0.5" role="tablist" aria-label="Plugin source">
                    {sourceThumb && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute bottom-0.5 left-0 top-0.5 rounded-[6px] bg-[var(--bg-card,#fff)] shadow-[inset_0_0_0_1px_var(--border-default),0_1px_2px_rgb(0_0_0/0.04)] transition-[transform,width] duration-150 ease-out"
                        style={{ width: sourceThumb.width, transform: `translateX(${sourceThumb.left}px)` }}
                      />
                    )}
                    {([["Yours", false], ["Discover", true]] as const).map(([label, discover]) => (
                      <button
                        key={label}
                        type="button"
                        role="tab"
                        aria-selected={browsing === discover}
                        onClick={() => { setBrowsing(discover); setFilter(""); setLimit(PAGE_SIZE) }}
                        className={`relative z-[1] inline-flex items-center justify-center rounded-[6px] px-2.5 text-chat-sm transition-colors ${browsing === discover ? "text-[var(--text-primary)]" : "text-[var(--text-primary)]/70 hover:text-[var(--text-primary)]"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {marketView && <span className="text-chat-sm font-medium text-[var(--text-primary)]">Marketplaces</span>}
          <span className="flex-1" />
          <label className="flex h-7 w-52 items-center gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)] px-2.5 text-[var(--sidebar-text-muted)] focus-within:bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)]">
            <Search size={13} className="shrink-0" />
            <input
              value={filter}
              onChange={(e) => { setFilter(e.target.value); setLimit(PAGE_SIZE) }}
              placeholder="Search"
              aria-label="Search"
              className="min-w-0 flex-1 bg-transparent text-chat-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--sidebar-text-muted)]"
            />
            {filter && (
              <button type="button" aria-label="Clear search" onClick={() => { setFilter(""); setLimit(PAGE_SIZE) }} className="rounded p-0.5 text-[var(--sidebar-text-muted)] hover:text-[var(--text-primary)]">
                <X size={12} />
              </button>
            )}
          </label>
          <button type="button" aria-label={descending ? "Sort A to Z" : "Sort Z to A"} title={descending ? "Sort A to Z" : "Sort Z to A"} className={iconButton} onClick={() => setDescending((value) => !value)}><ArrowUpDown size={14} /></button>
          <div className="relative">
            <button type="button" aria-haspopup="menu" aria-expanded={menuOpen} className={primaryButton} onClick={() => setMenuOpen((value) => !value)}>
              <Plus size={14} />
              Add
              <ChevronDown size={14} />
            </button>
            {menuOpen && (
              <>
                <button type="button" aria-label="Close menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuOpen(false)} />
                <div role="menu" className="noa-floating-panel absolute right-0 top-full z-20 mt-1.5 flex min-w-48 flex-col rounded-[var(--menu-popover-radius)] bg-[var(--bg-card)] p-1 shadow-[var(--menu-shadow)]">
                  <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); setAdding(true); setTab("marketplace"); setBrowsing(false) }}>Add marketplace</button>
                  <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); setTab("marketplace"); setBrowsing(false); setFilter("") }}>Manage marketplaces</button>
                  <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); onOpenMcp() }}>Add MCP server</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {adding && !inDetail && (
        <form
          className="flex flex-col gap-3 rounded-2xl border border-[var(--border-default)] px-4 py-3.5"
          onSubmit={async (e) => {
            e.preventDefault()
            if (await run("add", "marketplace-add", source.trim(), sparse, "Failed to add marketplace")) {
              setAdding(false)
              setSource("")
              setSparse("")
            }
          }}
        >
          <span className="text-body font-medium">Add plugin marketplace</span>
          <span className="text-body text-[var(--sidebar-text-muted)]">Add from a GitHub repo, Git URL, or local folder.</span>
          {([
            ["Source", source, setSource, "owner/repo or git@github.com:org/repo.git", true],
            ["Sparse paths", sparse, setSparse, "plugins/example (optional)", false],
          ] as const).map(([label, value, set, placeholder, focus]) => (
            <label key={label} className="flex flex-col gap-1.5 text-body text-[var(--text-secondary)]">
              {label}
              <input
                autoFocus={focus}
                value={value}
                onChange={(e) => set(e.target.value)}
                placeholder={placeholder}
                disabled={busy === "add"}
                className="h-9 rounded-xl border border-[var(--border-default)] bg-transparent px-3 text-body text-[var(--text-primary)] outline-none placeholder:text-[var(--sidebar-text-muted)]"
              />
            </label>
          ))}
          <div className="flex justify-end gap-2">
            <button type="button" className={outlineButton} disabled={busy === "add"} onClick={() => { setAdding(false); setError(undefined) }}>Cancel</button>
            <button type="submit" className={primaryButton} disabled={!source.trim() || busy === "add"}>{busy === "add" ? "Adding…" : "Add marketplace"}</button>
          </div>
        </form>
      )}
      {currentSkill && createPortal(
        <div
          className="noa-confirm-scrim fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(event) => { if (event.target === event.currentTarget) setSkillName(undefined) }}
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setSkillName(undefined) } }}
        >
          <div role="dialog" aria-modal="true" aria-label={titleCase(currentSkill.name)} className="noa-confirm-dialog flex max-h-[85vh] w-full max-w-[560px] flex-col gap-3 rounded-2xl bg-[var(--bg-card)] p-5 font-ui">
            <div className="flex items-center justify-between">
              <span className={`${tileClass} rounded-full`}><CubeIcon /></span>
              <span className="relative flex items-center gap-1">
                {switchable(currentSkill) && <Toggle checked={!skillOff(currentSkill.name)} label={skillOff(currentSkill.name) ? "Enable skill" : "Disable skill"} onChange={(enabled) => void setSkillMode(currentSkill.name, enabled)} />}
                {removable.includes(currentSkill.name) && (
                  <>
                    <button type="button" aria-label="Skill actions" aria-haspopup="menu" className={iconButton} onClick={() => setSkillMenu((value) => !value)}>
                      <span aria-hidden="true" className="px-0.5 text-body leading-none">•••</span>
                    </button>
                    {skillMenu && (
                      <>
                        <button type="button" aria-label="Close menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setSkillMenu(false)} />
                        <div role="menu" className="noa-floating-panel absolute right-0 top-full z-20 mt-1 flex min-w-44 flex-col rounded-[var(--menu-popover-radius)] bg-[var(--bg-card)] p-1 shadow-[var(--menu-shadow)]">
                          <button type="button" role="menuitem" className="h-8 rounded-lg px-2.5 text-left text-body hover:bg-[var(--settings-fill-hover)]" onClick={() => { setSkillMenu(false); void runSkillAction("reveal", currentSkill.name).catch((e: Error) => setError(e.message)) }}>Reveal in Finder</button>
                          <button type="button" role="menuitem" disabled={skillText === undefined} className="h-8 rounded-lg px-2.5 text-left text-body hover:bg-[var(--settings-fill-hover)] disabled:opacity-40" onClick={() => { setSkillMenu(false); void navigator.clipboard.writeText(skillText ?? "").then(() => flashNotice("Copied Markdown"), (e: Error) => setError(e.message)) }}>Copy Markdown</button>
                        </div>
                      </>
                    )}
                  </>
                )}
                <button type="button" aria-label="Close" className={iconButton} onClick={() => setSkillName(undefined)}><X size={16} /></button>
              </span>
            </div>
            <h2 className="m-0 flex items-baseline gap-2 text-[18px] font-medium leading-6">
              {titleCase(currentSkill.name)}
              <span className="text-[16px] font-normal text-[var(--sidebar-text-muted)]">Skill</span>
              {skillOff(currentSkill.name) && <span className="rounded-md border border-[var(--border-default)] px-1.5 text-caption font-normal text-[var(--sidebar-text-muted)]">Disabled</span>}
            </h2>
            <p className="noa-selectable m-0 whitespace-pre-wrap break-words text-body leading-[22px] text-[var(--sidebar-text-muted)]">{currentSkill.rawDescription ?? currentSkill.description}</p>
            {skillText !== undefined && skillBody(skillText) && (
              <div className="noa-selectable min-h-0 flex-1 overflow-y-auto rounded-xl border border-[var(--border-default)] px-4 py-3 text-body">
                <Markdown text={skillBody(skillText)} />
              </div>
            )}
            <div className="mt-1 flex items-center justify-between">
              {removable.includes(currentSkill.name) ? (
                <button type="button" className="h-8 rounded-[10px] bg-[color-mix(in_srgb,#C24444_12%,transparent)] px-3.5 text-body text-[#C24444] hover:bg-[color-mix(in_srgb,#C24444_18%,transparent)]" onClick={() => void uninstallSkill(currentSkill.name)}>Uninstall</button>
              ) : <span />}
              <button type="button" className={primaryButton} disabled={skillOff(currentSkill.name)} onClick={() => onTrySkill(currentSkill.name)}>Try now</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {error && (
        <p role="alert" className="noa-selectable m-0 whitespace-pre-wrap rounded-xl bg-[color-mix(in_srgb,#C24444_10%,transparent)] px-3 py-2 text-body text-[#C24444]">{error}</p>
      )}
      {notice && !error && <p role="status" className="m-0 inline-flex items-center gap-1.5 text-chat-sm text-[var(--sidebar-text-muted)]"><Check size={14} />{notice}</p>}
      {body}
      {dialog}
    </>
  )
}
