import { defaultShortcuts, shortcutHint, type ShortcutBindings } from "../lib/shortcuts"
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react"
import { isSubagentTask, type AgentState } from "../agent/reducer"
import type { TurnDiff } from "../agent/protocol"
import { Folder, Globe, MoreHorizontal, PanelBottom, Plus, PlusMinus, Terminal, Users } from "../lib/icons"
import { browserVersion, closeBrowser, dismissWebUrl, localWebUrls, openBrowser, projectBrowser, selectBrowser, subscribeBrowser } from "../lib/browserTabs"
import { BrowserPanel } from "./BrowserPanel"
import { closeTerminal, moveTerminal, openTerminal, selectTerminal, snapshotTerminals, subscribeTerminals, terminalsVersion, terminalTabs } from "../lib/terminalSessions"
import { query } from "../api"
import { SPLIT_MIN_WIDTH, useDiffPref } from "../lib/diffPrefs"
import { PopupMenu, anchorBelow, type PopupMenuAnchor } from "./PopupMenu"
import { TurnReview } from "./TurnReview"
import { WorkspaceFiles } from "./WorkspaceFiles"
import { SubagentsPanel } from "./SubagentsPanel"
import { NewTabPage } from "./NewTabPage"
import { PanelTabStrip } from "./PanelTabStrip"
import { TerminalView } from "./TerminalView"

// Tools that open at most once; terminals open as many tabs as wanted.
export type PanelTab = "files" | "changes" | "subagents"
// The shown pane: a tool, the New tab page, or the panel's active terminal/browser.
export type RightTab = PanelTab | "new" | "terminal" | "browser"
export const DEFAULT_RIGHT_TABS: PanelTab[] = ["files", "changes"]

// The panel sits in a no-drag column; its tab row drags the window again, except on the tabs themselves.
const dragRegion = { WebkitAppRegion: "drag" } as CSSProperties
const noDragRegion = { WebkitAppRegion: "no-drag" } as CSSProperties

const SOURCES = { turn: "Last turn", all: "Uncommitted", unstaged: "Unstaged", staged: "Staged", branch: "Branch comparison", commit: "Committed" } as const

const TOOLS = {
  files: { title: "Files", icon: Folder },
  changes: { title: "Changes", icon: PlusMinus },
  subagents: { title: "Subagents", icon: Users },
} as const
// Subagents open from the Overview's Tasks card or the conversation, not from the New tab page.
const NEW_TAB_TOOLS: PanelTab[] = ["files", "changes"]
const TERMINAL_KEY = "terminal:"
const BROWSER_KEY = "browser:"

interface RightPanelProps {
  shortcuts?: ShortcutBindings
  state: AgentState
  onStopTask: (id: string) => void
  cwd: string
  // Whether the panel is shown; a hidden panel keeps its panes but does not attach a terminal.
  open?: boolean
  tabs: PanelTab[]
  onTabs: (tabs: PanelTab[]) => void
  newTab: boolean
  onNewTab: (open: boolean) => void
  tab: RightTab
  onTab: (tab: RightTab) => void
  terminalFocusKey?: number
  // A terminal moved to the bottom panel, or the New tab page asked for it.
  onBottomTerminal?: () => void
  onReference: (path: string) => void
  onWorkspaceChange?: () => void
  workspaceRefreshKey: number
  focusChange?: { path: string; at: number }
  focusFile?: { path: string; at: number; line?: number; endLine?: number }
  turnDiff?: { diff: TurnDiff; path?: string; key: number }
  focusTask?: { id?: string; key: number }
}

// Right column: one pane under a tab strip.
export function RightPanel({ shortcuts = defaultShortcuts, state, onStopTask, cwd, open = true, tabs, onTabs, newTab, onNewTab, tab, onTab, terminalFocusKey, onBottomTerminal, onReference, onWorkspaceChange, workspaceRefreshKey, focusChange, focusFile, turnDiff, focusTask }: RightPanelProps) {
  useSyncExternalStore(subscribeTerminals, terminalsVersion, terminalsVersion)
  useSyncExternalStore(subscribeBrowser, browserVersion, browserVersion)
  const browser = projectBrowser(cwd)
  const supportsBrowser = typeof window !== 'undefined' && !!window.noaDesktop?.preview
  const activeBrowser = browser.tabs.find(page => page.id === browser.active) ?? browser.tabs[0]
  const replyUrls = useMemo(() => localWebUrls(state.turns.flatMap(turn => turn.role === 'assistant' && !turn.streaming ? turn.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []) : []).join('\n')), [state.turns])
  const suggested = [...new Set([...browser.suggested, ...replyUrls])].filter(url => !browser.dismissed.has(url))
  const terminals = snapshotTerminals(cwd, "right")
  const activeTerminal = terminals.find((terminal) => terminal.id === terminalTabs(cwd, "right").active) ?? terminals[0]
  // Strip order: tools, terminals, browser pages, then an open New tab.
  const stripKeys = [...tabs, ...terminals.map((terminal) => TERMINAL_KEY + terminal.id), ...browser.tabs.map(page => BROWSER_KEY + page.id), ...(newTab ? ["new"] : [])]
  const activeKey = tab === "terminal" ? (activeTerminal ? TERMINAL_KEY + activeTerminal.id : undefined) : tab === "browser" ? (activeBrowser ? BROWSER_KEY + activeBrowser.id : undefined) : tab
  const shownKey = activeKey && stripKeys.includes(activeKey) ? activeKey : stripKeys[0]
  // With no tabs at all the New tab page fills the panel, as an empty state.
  const shown: RightTab = !shownKey || shownKey === "new" ? "new" : shownKey.startsWith(TERMINAL_KEY) ? "terminal" : shownKey.startsWith(BROWSER_KEY) ? "browser" : (shownKey as PanelTab)
  useEffect(() => {
    if (shownKey && shownKey !== activeKey) select(shownKey)
  })
  function select(key: string) {
    if (key.startsWith(TERMINAL_KEY)) {
      selectTerminal(cwd, key.slice(TERMINAL_KEY.length))
      onTab("terminal")
    } else if (key.startsWith(BROWSER_KEY)) {
      selectBrowser(cwd, key.slice(BROWSER_KEY.length))
      onTab("browser")
    } else onTab(key as RightTab)
  }
  function close(key: string) {
    const index = stripKeys.indexOf(key)
    const rest = stripKeys.filter((other) => other !== key)
    if (key === "new") onNewTab(false)
    else if (key.startsWith(TERMINAL_KEY)) closeTerminal(cwd, key.slice(TERMINAL_KEY.length))
    else if (key.startsWith(BROWSER_KEY)) closeBrowser(cwd, key.slice(BROWSER_KEY.length))
    else onTabs(tabs.filter((other) => other !== key))
    if (key === shownKey) {
      const next = rest[Math.min(index, rest.length - 1)]
      if (next) select(next)
      else onTab("new")
    }
  }
  // A tool chosen on the New tab page takes that tab's place; an open tool is focused instead of duplicated.
  function openTool(id: string) {
    onNewTab(false)
    if (id === "browser") { openBrowser(cwd); onTab("browser"); return }
    if (id === "terminal") {
      openTerminal(cwd, "right")
      onTab("terminal")
      return
    }
    const tool = id as PanelTab
    if (!tabs.includes(tool)) onTabs([...tabs, tool])
    onTab(tool)
  }
  const [tabMenu, setTabMenu] = useState<{ key: string; anchor: PopupMenuAnchor }>()
  const [selectedTask, setSelectedTask] = useState<string>()
  useEffect(() => { setSelectedTask(focusTask?.id) }, [focusTask, state.sessionId])
  const subagents = state.tasks.filter(isSubagentTask)
  const [fileChange, setFileChange] = useState<{ cwd: string; path: string; at: number; scope: "all" }>()
  // One review source: the last turn's patch or a slice of the working tree.
  const [source, setSource] = useState<"turn" | "all" | "unstaged" | "staged" | "branch" | "commit">("all")
  useEffect(() => {
    setSource(turnDiff ? "turn" : "all")
  }, [turnDiff?.key, turnDiff === undefined])
  const changeMode = source === "turn" && turnDiff ? "turn" : "working"
  // Branch comparison and commit review are read-only sources picked from a second selector.
  const [refs, setRefs] = useState<{ cwd: string; branches: { name: string; current: boolean }[]; commits: { sha: string; short: string; subject: string; date: string }[]; error?: string }>()
  const [branchTarget, setBranchTarget] = useState<string>()
  const [commitSha, setCommitSha] = useState<string>()
  useEffect(() => {
    if (source !== "branch" && source !== "commit") return
    const controller = new AbortController()
    const get = async <T,>(route: string) => {
      const response = await fetch(`/api/${route}${query(cwd)}`, { signal: controller.signal })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error ?? "Could not load Git history")
      return value as T
    }
    Promise.all([get<{ isGit: boolean; current?: string | null; defaultBranch?: string | null; branches?: string[] }>("branches"), get<{ commits: NonNullable<typeof refs>["commits"] }>("commits")])
      .then(([branchInfo, history]) => {
        const names = branchInfo.branches ?? []
        setRefs({ cwd, branches: names.map((name) => ({ name, current: name === branchInfo.current })), commits: history.commits })
        setBranchTarget((chosen) => chosen && names.includes(chosen) ? chosen : names.find((name) => name !== branchInfo.current && name === branchInfo.defaultBranch) ?? names.find((name) => name !== branchInfo.current))
        setCommitSha((chosen) => chosen && history.commits.some((commit) => commit.sha === chosen) ? chosen : history.commits[0]?.sha)
      })
      .catch((error: Error) => { if (!controller.signal.aborted) setRefs({ cwd, branches: [], commits: [], error: error.message }) })
    return () => controller.abort()
  }, [source, cwd])
  const refsReady = refs?.cwd === cwd ? refs : undefined
  const [sourceMenu, setSourceMenu] = useState<{ anchor: PopupMenuAnchor; trigger: Element }>()
  const shownSource = changeMode === "turn" ? "turn" : source === "turn" ? "all" : source
  const [refMenu, setRefMenu] = useState<{ anchor: PopupMenuAnchor; trigger: Element }>()
  useEffect(() => { setRefMenu(undefined); setSourceMenu(undefined) }, [source, cwd])
  // Until a target is picked, a read-only comparison of HEAD with itself shows no differences rather than the working tree.
  const scope = source === "turn" ? "all" : source === "branch" ? `branch:${branchTarget ?? "HEAD"}` : source === "commit" ? (commitSha ? `commit:${commitSha}` : "branch:HEAD") : source
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle")
  const copyApply = async (close: () => void) => {
    close()
    try {
      const response = await fetch(`/api/patch${query(cwd)}&${new URLSearchParams({ scope })}`)
      const value = await response.json()
      if (!response.ok) throw new Error(value.error)
      if (!value.patch) throw new Error("empty")
      await navigator.clipboard.writeText(`git apply <<'NOA_PATCH'\n${value.patch.replace(/\n?$/, "\n")}NOA_PATCH\n`)
      setCopied("done")
    } catch { setCopied("failed") }
    setTimeout(() => setCopied("idle"), 2000)
  }
  const [revealFile, setRevealFile] = useState<{ path: string; at: number }>()
  const [foldAll, setFoldAll] = useState<{ collapsed: boolean; seq: number }>()
  const [fileTree, setFileTree] = useDiffPref("fileTree")
  const [wordDiff, setWordDiff] = useDiffPref("wordDiff")
  const [hideWhitespace, setHideWhitespace] = useDiffPref("hideWhitespace")
  const [sideBySide, setSideBySide] = useDiffPref("sideBySide")
  const [wordWrap, setWordWrap] = useDiffPref("wordWrap")
  const changesRef = useRef<HTMLDivElement>(null)
  const [canSplit, setCanSplit] = useState(true)
  useEffect(() => {
    const element = changesRef.current
    if (!element) return
    const observer = new ResizeObserver(() => { if (element.offsetWidth > 0) setCanSplit(element.offsetWidth >= SPLIT_MIN_WIDTH) })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[var(--surface-page,#F9F9F7)] font-ui">
      {/* Level with the window controls; the right inset clears the header buttons fixed over this corner. */}
      <PanelTabStrip
        className="h-11 pr-[100px]"
        style={dragRegion}
        controlStyle={noDragRegion}
        label="Panel tabs"
        tabs={stripKeys.map((key) => {
          if (key === "new") return { key, title: "New tab", icon: Plus }
          if (key.startsWith(TERMINAL_KEY)) return { key, title: terminals.find((terminal) => TERMINAL_KEY + terminal.id === key)?.title ?? "Terminal", icon: Terminal }
          if (key.startsWith(BROWSER_KEY)) {
            const page = browser.tabs.find(page => BROWSER_KEY + page.id === key)
            return { key, title: page?.title || (page?.url ? new URL(page.url).host : "Browser"), icon: Globe }
          }
          return { key, ...TOOLS[key as PanelTab] }
        })}
        activeKey={shownKey}
        onSelect={select}
        onClose={close}
        onContextMenu={(key, event) => { if (key.startsWith(TERMINAL_KEY)) setTabMenu({ key, anchor: { left: event.clientX, top: event.clientY, bottom: event.clientY } }) }}
        onNew={() => { onNewTab(true); onTab("new") }}
        newLabel="New tab"
      />
      {tabMenu && (
        <PopupMenu
          anchor={tabMenu.anchor}
          label="Terminal tab"
          onClose={() => setTabMenu(undefined)}
          entries={[{ key: "move-bottom", label: "Move to bottom pane", icon: PanelBottom, onSelect: () => { moveTerminal(cwd, tabMenu.key.slice(TERMINAL_KEY.length), "bottom"); onBottomTerminal?.() } }]}
        />
      )}
      {shown === "new" && (
        <NewTabPage
          shortcuts={shortcuts}
          tools={[
            ...NEW_TAB_TOOLS.map((id) => ({ id, ...TOOLS[id] })),
            { id: "terminal", title: "Terminal", icon: Terminal, shortcut: shortcutHint(shortcuts.terminal) },
            ...(supportsBrowser ? [{ id: "browser", title: "Browser", icon: Globe }] : []),
          ]}
          suggested={supportsBrowser ? suggested : []}
          onOpenUrl={url => { onNewTab(false); openBrowser(cwd, url); onTab("browser") }}
          onDismissUrl={url => dismissWebUrl(cwd, url)}
          onSelect={openTool}
          onOpenBottomTerminal={() => onBottomTerminal?.()}
        />
      )}
      {shown === "terminal" && activeTerminal && (
        <div className="flex min-h-0 flex-1 flex-col">
          <TerminalView key={activeTerminal.id} cwd={cwd} terminal={activeTerminal} visible={open} focusKey={terminalFocusKey} />
        </div>
      )}
      {activeBrowser && <div className="min-h-0 flex-1 flex-col" style={{ display: shown === "browser" ? "flex" : "none" }}>
        <BrowserPanel key={activeBrowser.id} cwd={cwd} tab={activeBrowser} visible={open && shown === "browser"} />
      </div>}
      <div id="panel-files" role="tabpanel" aria-labelledby="panel-tab-files" className="min-h-0 flex-1 flex-col overflow-hidden" style={{ display: shown === "files" ? "flex" : "none" }}>
        <WorkspaceFiles key={`files-${cwd}`} cwd={cwd} active={shown === "files"} focus={focusFile} reveal={revealFile} refreshKey={workspaceRefreshKey} onReference={onReference} onUpdated={onWorkspaceChange} onOpenChanges={(path) => { if (path) setFileChange({ cwd, path, at: Date.now(), scope: "all" }); setSource("all"); onTab("changes") }} />
      </div>
      <div ref={changesRef} id="panel-changes" role="tabpanel" aria-labelledby="panel-tab-changes" className="min-h-0 flex-1 flex-col overflow-hidden" style={{ display: shown === "changes" ? "flex" : "none" }}>
        <div className="noa-panel-toolbar noa-turn-scope">
          <button type="button" className="noa-ref-trigger is-source" aria-label="Review source" aria-haspopup="menu" aria-expanded={!!sourceMenu} onClick={(event) => setSourceMenu(sourceMenu ? undefined : { anchor: anchorBelow(event.currentTarget), trigger: event.currentTarget })}>{SOURCES[shownSource]}</button>
          {sourceMenu && (
            <PopupMenu
              anchor={sourceMenu.anchor}
              trigger={sourceMenu.trigger}
              label="Review source"
              onClose={() => setSourceMenu(undefined)}
              entries={(Object.keys(SOURCES) as (keyof typeof SOURCES)[]).filter((id) => id !== "turn" || turnDiff).map((id) => ({ key: id, label: SOURCES[id], checked: id === shownSource, onSelect: () => setSource(id) }))}
            />
          )}
          {(source === "branch" || source === "commit") && (() => {
            const items = source === "branch" ? refsReady?.branches.filter((branch) => !branch.current) : refsReady?.commits
            if (!items?.length) return <span className="min-w-0 truncate text-caption text-[var(--sidebar-text-muted)]">{refsReady?.error ?? (refsReady ? (source === "branch" ? "No other branches" : "No commits yet") : "Loading…")}</span>
            const commit = refsReady?.commits.find((entry) => entry.sha === commitSha)
            const current = refsReady?.branches.find((branch) => branch.current)?.name ?? "HEAD"
            return <button type="button" className="noa-ref-trigger" aria-haspopup="menu" aria-expanded={!!refMenu} aria-label={source === "branch" ? "Compare with branch" : "Commit"} title={source === "branch" ? undefined : commit?.subject} onClick={(event) => setRefMenu(refMenu ? undefined : { anchor: anchorBelow(event.currentTarget), trigger: event.currentTarget })}>
              {source === "branch" ? `${current} → ${branchTarget ?? ""}` : commit ? `${commit.short} ${commit.subject}` : ""}
            </button>
          })()}
          {refMenu && (source === "branch" || source === "commit") && refsReady && (
            <PopupMenu
              anchor={refMenu.anchor}
              trigger={refMenu.trigger}
              label={source === "branch" ? "Review branches" : "Review commits"}
              onClose={() => setRefMenu(undefined)}
              entries={source === "branch"
                ? refsReady.branches.filter((branch) => !branch.current).map((branch) => ({ key: branch.name, label: <span className="noa-ref-option"><span className="noa-ref-subject">{branch.name}</span></span>, checked: branch.name === branchTarget, onSelect: () => setBranchTarget(branch.name) }))
                : refsReady.commits.map((commit) => ({ key: commit.sha, label: <span className="noa-ref-option"><span className="noa-ref-sha">{commit.short}</span><span className="noa-ref-subject">{commit.subject}</span><span className="noa-ref-date">{commit.date}</span></span>, checked: commit.sha === commitSha, onSelect: () => setCommitSha(commit.sha) }))}
            />
          )}
          {changeMode === "turn" && turnDiff && (
            <span className="min-w-0 truncate text-caption tabular-nums text-[var(--sidebar-text-muted)]">
              {turnDiff.diff.files.length} {turnDiff.diff.files.length === 1 ? "file" : "files"}
            </span>
          )}
          {/* Claude Code's Changes pane menu: file list, fold, then display groups. */}
          <details className="noa-review-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false }} onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.open = false }}>
            <summary role="button" className="noa-panel-button" aria-label="Diff options" title="Diff options"><MoreHorizontal size={16} /></summary>
            <div className="noa-review-menu-content noa-floating-panel">
              {changeMode === "working" && <>
                <label className="noa-viewed-label"><input type="checkbox" checked={fileTree} onChange={(event) => setFileTree(event.target.checked)} />Group files by folder</label>
                {fileTree && <>
                  <div className="noa-review-menu-separator" role="separator" />
                  <button type="button" className="noa-panel-button" onClick={(event) => { setFoldAll((fold) => ({ collapsed: true, seq: (fold?.seq ?? 0) + 1 })); event.currentTarget.closest("details")!.open = false }}>Collapse all files</button>
                  <button type="button" className="noa-panel-button" onClick={(event) => { setFoldAll((fold) => ({ collapsed: false, seq: (fold?.seq ?? 0) + 1 })); event.currentTarget.closest("details")!.open = false }}>Expand all files</button>
                </>}
                <div className="noa-review-menu-separator" role="separator" />
              </>}
              <label className="noa-viewed-label" title={sideBySide && !canSplit ? "Needs a wider pane" : undefined}><input type="checkbox" checked={sideBySide} onChange={(event) => setSideBySide(event.target.checked)} />Side by side{sideBySide && !canSplit && <span className="noa-review-menu-hint">Needs a wider pane</span>}</label>
              <label className="noa-viewed-label"><input type="checkbox" checked={wordWrap} onChange={(event) => setWordWrap(event.target.checked)} />Word wrap</label>
              <div className="noa-review-menu-separator" role="separator" />
              {changeMode === "working" && <button type="button" className="noa-panel-button" onClick={(event) => { void copyApply(() => { event.currentTarget.closest("details")!.open = false }) }}>{copied === "done" ? "Copied" : copied === "failed" ? "Nothing to copy" : "Copy git apply command"}</button>}
              {changeMode === "working" && <div className="noa-review-menu-separator" role="separator" />}
              <label className="noa-viewed-label"><input type="checkbox" checked={wordDiff} onChange={(event) => setWordDiff(event.target.checked)} />Highlight changed words</label>
              <label className="noa-viewed-label"><input type="checkbox" checked={hideWhitespace} onChange={(event) => setHideWhitespace(event.target.checked)} />Hide whitespace changes</label>
            </div>
          </details>
        </div>
        <div className="min-h-0 flex-1 flex-col" style={{ display: shown === "changes" && changeMode === "working" ? "flex" : "none" }}>
          <WorkspaceFiles key={`changes-${cwd}`} cwd={cwd} changes scope={scope} focus={fileChange?.cwd === cwd && (!focusChange || fileChange.at > focusChange.at) ? fileChange : focusChange} foldAll={foldAll} canSplit={canSplit} onRevealInTree={(path) => { setRevealFile({ path, at: Date.now() }); onTab("files") }} active={shown === "changes" && changeMode === "working"} refreshKey={workspaceRefreshKey} onReference={onReference} onUpdated={onWorkspaceChange} />
        </div>
        {turnDiff && (
          <div className="min-h-0 flex-1 flex-col" style={{ display: shown === "changes" && changeMode === "turn" ? "flex" : "none" }}>
            <TurnReview diff={turnDiff.diff} focusPath={turnDiff.path} focusKey={turnDiff.key} canSplit={canSplit} />
          </div>
        )}
      </div>
      <div id="panel-subagents" role="tabpanel" aria-labelledby="panel-tab-subagents" className="min-h-0 flex-1 flex-col overflow-hidden" style={{ display: shown === "subagents" ? "flex" : "none" }}>
        <SubagentsPanel tasks={subagents} selectedId={selectedTask} onSelect={setSelectedTask} onStopTask={onStopTask} />
      </div>
    </div>
  )
}
