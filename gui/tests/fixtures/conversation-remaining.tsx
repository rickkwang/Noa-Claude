import { App } from "../../src/App"
import { initialState, reducer } from "../../src/agent/reducer"
import { TurnDiffCard } from "../../src/components/TurnDiffCard"
import { createElement, useState } from "react"
import { createRoot } from "react-dom/client"
import { Markdown, OutputContext } from "../../src/components/Markdown"
import { PermissionCard } from "../../src/components/PermissionCard"
import { ToolCard } from "../../src/components/ToolCard"
import { MessageRail } from "../../src/components/MessageRail"
import { MessageList } from "../../src/components/MessageList"
import { Lightbox } from "../../src/components/Lightbox"
import CodeView from "../../src/components/CodeView"
import ThemeInjector from "../../src/theme/ThemeInjector"
import { defaultSettings } from "../../src/theme/settings"
import { WorkspaceFiles } from "../../src/components/WorkspaceFiles"
import { TurnReview } from "../../src/components/TurnReview"
import { useAgent } from "../../src/agent/useAgent"
import { RightPanel } from "../../src/components/RightPanel"

declare global { interface Window { [key: string]: any } }
const visualTheme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light"
const root = createRoot(document.getElementById("root")!)
const data = await (await fetch("/scenarios.json")).json()
const results: Record<string, boolean> = {}
const wait = async (predicate: () => boolean, timeout = 1500) => {
  const until = performance.now() + timeout
  while (!predicate() && performance.now() < until) await new Promise(requestAnimationFrame)
  return predicate()
}
const show = async (node: any) => { root.render(node); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame) }
const tools = data.replay.turns.flatMap((turn: any) => turn.blocks ?? [])
const hooks = data.hooks.turns.flatMap((turn: any) => (turn.blocks ?? []).filter((block: any) => block.name === "Hook"))
const update = { kind: "tool", id: "update", name: "TaskUpdate", input: { taskId: "7", subject: "Updated title" }, partialJson: "", status: "done", rawResult: { success: true, taskId: "7", updatedFields: ["subject"] } } as any
const mcp = { ...update, id: "mcp", name: "mcp__local__query", input: {}, rawResult: { structuredContent: { rows: [1, 2] }, _meta: { cursor: "next" } } }
const todo = { ...update, id: "todo", name: "TodoWrite", input: { todos: [{ content: "Inspect files", status: "completed" }, { content: "Run checks", status: "in_progress" }] }, rawResult: undefined }
const panel = (name: string, title: string, body: any) => <section data-case={name}><h2>{title}</h2>{body}</section>

function ContextProbe() {
  const { state } = useAgent({ cwd: "/fixture", sessionKey: 0, runtimeId: "context-probe" })
  return <span data-context-loading={state.contextLoading ? "yes" : "no"} />
}

function WorkspacePanelProbe() {
  const [tab, setTab] = useState<"files" | "changes" | "context" | "activity">("changes")
  return <div style={{ width: 500, height: 500 }}><RightPanel state={{ ...initialState, connection: "ready" }} cwd="/fixture" tab={tab} onTab={setTab} onStopTask={() => {}} onRefreshContext={() => {}} onLoadEarlier={() => {}} onReference={() => {}} workspaceRefreshKey={0} /></div>
}

function Comparison() {
  const [range, setRange] = useState<{ line?: number; end?: number }>({})
  return <><ThemeInjector settings={{ ...defaultSettings, appearance: { ...defaultSettings.appearance, theme: visualTheme } }} /><div className="grid">
    {panel("replay", "Parallel tools after reconnect", <>{tools.map((block: any) => <ToolCard key={block.id} block={block} defaultOpen />)}<p>{tools.length} tool calls retained</p></>)}
    {panel("task", "Restored background Agent", <ToolCard block={{ ...update, id: "agent", name: "Agent", input: { description: "Inspect project" } }} task={data.task.tasks[0]} defaultOpen />)}
    {panel("math", "Shell text and Codex math fence", <><Markdown text="Use $HOME/$USER" /><div data-math-fence><Markdown text={"```math\n\\frac{a}{b} + \\sqrt{c}\n```"} /></div></>)}
    {panel("update", "Title-only TaskUpdate", <><p>Status was omitted from this update.</p><ToolCard block={update} defaultOpen /></>)}
    {panel("citation", "File reference with a line range", <OutputContext value={{ cwd: data.cwd, onOpenFile: (_path, line, end) => setRange({ line, end }) }}>
      <Markdown text={':codex-file-citation{path="a.ts" lineRangeStart="2" lineRangeEnd="4" title="Inspect lines 2–4"}'} />
      <CodeView path="a.ts" content={"const first = 1\nconst second = 2\nconst third = 3\nconst fourth = 4\nconst fifth = 5"} focusLine={range.line} focusEndLine={range.end} />
    </OutputContext>)}
    {panel("details", "Structured disclosure", <Markdown text={"<details>\n<summary>More **context**</summary>\n\nDetails stay readable without executing raw HTML.\n</details>"} />)}
    {panel("hook", "Hook after loading older history", <>{hooks.map((block: any, i: number) => <ToolCard key={i} block={block} defaultOpen />)}<p>{hooks.length} hook entry</p></>)}
    {panel("media", "Local media over HTTP", <OutputContext value={{ cwd: data.cwd }}><Markdown text="![Recorded output](tone.wav)" /></OutputContext>)}
  </div></>
}

const initial = Array.from({ length: 4 }, (_, i) => ({ id: `old${i}`, label: `Original prompt ${i + 1}`, ordinal: i, preview: "Reply" }))
window.runChecks = async () => {
  await show(<Comparison />)
  results.parallelReplay = tools.some((block: any) => block.id === "t1") && document.querySelectorAll('[data-case="replay"] [data-tool-activity]').length === 2
  results.agentTerminal = data.task.tasks[0]?.status === "completed" && document.querySelector('[data-case="task"]')!.textContent!.includes("completed")
  results.shellVariables = document.querySelector('[data-case="math"]')!.textContent!.includes("$HOME/$USER")
  results.mathFence = !!document.querySelector("[data-math-fence] .katex")
  results.partialTaskUpdate = !document.querySelector('[data-case="update"] [aria-label="pending"]')
  results.hookPage = hooks.length === 1 && hooks[0].status === "done"
  ;(document.querySelector('[data-case="citation"] button[title]') as HTMLElement)?.click()
  results.referenceRange = await wait(() => document.querySelectorAll('[data-case="citation"] [data-reference-line="true"]').length === 3)
  const disclosure = document.querySelector('[data-case="details"] details') as HTMLDetailsElement | null
  ;(disclosure?.querySelector("summary") as HTMLElement)?.click()
  results.details = !!disclosure && await wait(() => disclosure.open)
  results.httpMedia = await wait(() => !!document.querySelector("audio")?.readyState)
  const rangeResponse = await fetch(`/api/media?${new URLSearchParams({ cwd: data.cwd, path: "tone.wav" })}`, { headers: { Range: "bytes=0-3" } })
  results.httpRange = rangeResponse.status === 206 && await rangeResponse.text() === "RIFF"
  await show(<div style={{ position: "relative", height: 500 }}><MessageRail items={initial} activeIds={["old2"]} sessionId="bookmark-check" onJump={() => {}} /></div>)
  ;(document.querySelector('[data-message-rail-item="old2"]') as HTMLElement)?.click()
  await wait(() => !!document.querySelector('[aria-label="Bookmark turn"]'))
  ;(document.querySelector('[aria-label="Bookmark turn"]') as HTMLElement)?.click()
  await wait(() => !!document.querySelector('[data-bookmarked="true"]'))
  const preceding = Array.from({ length: 4 }, (_, i) => ({ id: `new${i}`, label: `Earlier prompt ${i + 1}`, preview: "", ordinal: i }))
  const prepended = [...preceding, ...initial].map((item, i) => ({ ...item, ordinal: i }))
  await show(<div style={{ position: "relative", height: 500 }}><MessageRail items={prepended} activeIds={["old2"]} sessionId="bookmark-check" onJump={() => {}} /></div>)
  results.bookmarkIdentity = document.querySelector('[data-bookmarked="true"]')?.closest("button")?.dataset.messageRailItem === "old2"
  await show(null)
  await show(<div style={{ position: "relative", height: 500 }}><MessageRail items={prepended} activeIds={["old2"]} sessionId="bookmark-check" onJump={() => {}} /></div>)
  results.bookmarkReload = document.querySelector('[data-bookmarked="true"]')?.closest("button")?.dataset.messageRailItem === "old2"
  ;(document.querySelector('[data-message-rail-item="old2"]') as HTMLElement).click()
  await wait(() => !!document.querySelector(".noa-message-rail-card"))
  const railList = document.querySelector<HTMLElement>(".noa-message-rail-list")!
  railList.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }))
  const fadeSamples: number[] = []
  const fadeStart = performance.now()
  while (performance.now() - fadeStart < 250) {
    await new Promise(requestAnimationFrame)
    const card = document.querySelector<HTMLElement>(".noa-message-rail-card")
    if (card) fadeSamples.push(Number(getComputedStyle(card).opacity))
  }
  results.railPreviewFade = fadeSamples.some(opacity => opacity > 0.05 && opacity < 0.95)
  ;(document.querySelector('[data-message-rail-item="old2"]') as HTMLElement).click()
  await wait(() => !!document.querySelector(".noa-message-rail-card"))
  railList.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }))
  await new Promise(requestAnimationFrame)
  document.querySelector<HTMLElement>(".noa-message-rail-card")!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: document.body }))
  await new Promise(resolve => setTimeout(resolve, 250))
  results.railPreviewFadeCancel = !!document.querySelector(".noa-message-rail-card:not([data-closing])")
  const railItems = initial.map(item => ({ ...item, preview: "A short reply with enough text to wrap as the conversation becomes narrower." }))
  await show(<div id="rail-resize" style={{ position: "relative", width: 500, height: 240 }}><MessageRail items={railItems} activeIds={["old3"]} onJump={() => {}} /></div>)
  ;(document.querySelector('[data-message-rail-item="old3"]') as HTMLElement).click()
  await wait(() => !!document.querySelector(".noa-message-rail-card"))
  const railHost = document.getElementById("rail-resize")!
  railHost.style.width = "180px"
  results.railPreviewNarrow = await wait(() => { const host = railHost.getBoundingClientRect(), card = document.querySelector(".noa-message-rail-card")!.getBoundingClientRect(); return card.top >= host.top && card.bottom <= host.bottom && card.right <= host.right })
  railHost.style.height = "140px"
  results.railPreviewResize = await wait(() => { const host = railHost.getBoundingClientRect(), card = document.querySelector(".noa-message-rail-card")!.getBoundingClientRect(); return card.top >= host.top && card.bottom <= host.bottom && card.right <= host.right })
  const navigationTurns = initial.map(item => ({ role: "user" as const, id: item.id, text: item.label }))
  await show(<div id="rail-gutter" style={{ display: "flex", width: 800, height: 500 }}><MessageList turns={navigationTurns} busy={false} readingWidth={600} /></div>)
  const gutter = document.getElementById("rail-gutter")!
  const visibleAtWide = await wait(() => !!document.querySelector(".noa-message-rail"))
  ;(document.querySelector('[data-message-rail-item="old2"]') as HTMLElement)?.click()
  await wait(() => !!document.querySelector(".noa-message-rail-card"))
  gutter.style.width = "640px"
  const hiddenWhenNarrow = await wait(() => document.querySelector('.noa-message-rail-layer[data-visible="false"][inert][aria-hidden="true"]') !== null && !document.querySelector(".noa-message-rail-card"))
  gutter.style.width = "800px"
  results.railGutterVisibility = visibleAtWide && hiddenWhenNarrow && await wait(() => !!document.querySelector('.noa-message-rail-layer[data-visible="true"]'))
  const railLayer = document.querySelector<HTMLElement>(".noa-message-rail-layer")!
  results.railFade = getComputedStyle(railLayer).transitionDuration === "0.15s"
  const originalFetch = window.fetch
  let failChanges = false
  let resolveStaged: ((response: Response) => void) | undefined
  window.fetch = async (input: any) => {
    const url = new URL(String(input), location.href)
    if (url.pathname === "/api/changes" && url.searchParams.get("scope") === "staged") return await new Promise<Response>(resolve => { resolveStaged = resolve })
    if (url.pathname === "/api/changes") return new Response(JSON.stringify(failChanges ? { error: "Fixture failure" } : { isGit: true, branch: "main", files: [{ path: "changed.txt", status: " M", additions: 1, deletions: 0, binary: false }], additions: 1, deletions: 0 }), { status: failChanges ? 500 : 200 })
    if (url.pathname === "/api/files") return new Response(JSON.stringify({ entries: url.searchParams.has("search") ? [{ name: "found.txt", path: "found.txt", directory: false }] : url.searchParams.get("path") === "folder" ? [{ name: "child.ts", path: "folder/child.ts", directory: false }] : [{ name: "folder", path: "folder", directory: true }], truncated: false }))
    if (url.pathname === "/api/diff") return new Response(JSON.stringify({ content: `--- a/changed.txt\n+++ b/changed.txt\n@@ -0,0 +1,1 @@\n+${"long_identifier_".repeat(80)}\n`, snapshot: "snapshot" }))
    if (url.pathname === "/api/git-action") return new Response(JSON.stringify({ error: "Fixture action failed" }), { status: 409 })
    return originalFetch(input)
  }
  await show(<div style={{ height: 500 }}><WorkspaceFiles cwd="/fixture" refreshKey={0} onReference={() => {}} /></div>)
  await wait(() => !!document.querySelector('[title="folder"]'))
  const folder = document.querySelector<HTMLElement>('[title="folder"]')!
  folder.focus(); folder.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
  results.treeKeyboardExpand = await wait(() => !!document.querySelector('[title="folder/child.ts"]'))
  const childIcon = document.querySelector<HTMLElement>('[title="folder/child.ts"] .noa-file-icon')!
  const folderIcon = folder.querySelector<HTMLElement>(".noa-file-icon")!
  results.treeFileIndent = Math.abs(childIcon.getBoundingClientRect().left - folderIcon.getBoundingClientRect().left - 12.5) < 0.1
  const guide = folder.querySelector<HTMLElement>(".noa-file-guides > span:last-child")!
  const childGuide = document.querySelector<HTMLElement>('[title="folder/child.ts"] .noa-file-guides > span:first-child')!
  results.treeGuidesContinuous = !!guide && !!childGuide && Math.abs(guide.getBoundingClientRect().height - folder.getBoundingClientRect().height) < 0.1 && Math.abs(guide.getBoundingClientRect().left - childGuide.getBoundingClientRect().left) < 0.1 && Math.abs(guide.getBoundingClientRect().bottom - childGuide.getBoundingClientRect().top) < 0.1 && getComputedStyle(guide.parentElement!).overflow === "visible"
  results.typescriptIcon = !!childIcon.querySelector("svg.noa-glyph-blue path[opacity]")
  folder.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
  results.treeKeyboardChild = document.activeElement?.getAttribute("title") === "folder/child.ts"
  document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
  results.treeKeyboardParent = document.activeElement === folder
  ;(Array.from(document.querySelectorAll<HTMLElement>('[role="treeitem"]')).find(e => e.textContent?.includes("All files")))?.click()
  const search = document.querySelector<HTMLInputElement>('[aria-label="Search files"]')!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "found")
  search.dispatchEvent(new Event("input", { bubbles: true }))
  results.searchAfterCollapse = await wait(() => !!document.querySelector('[title="found.txt"]'))
  localStorage.setItem("noa-diff-wrap", "false")
  localStorage.removeItem("noa-diff-wrap-v2")
  localStorage.setItem("noa-diff-layout", "unified")
  await show(<div style={{ width: 320, height: 400 }}><WorkspaceFiles key="diff" cwd="/fixture" changes refreshKey={0} onReference={() => {}} /></div>)
  await wait(() => !!document.querySelector('[title="changed.txt"]'))
  const scopeBar = document.querySelector<HTMLElement>('[aria-label="Changes scope"]')!
  const scopeTop = scopeBar.getBoundingClientRect().top
  ;(Array.from(scopeBar.querySelectorAll("button")).find(button => button.textContent === "Staged"))?.click()
  await wait(() => !!resolveStaged)
  results.changesScopeStable = document.querySelector('[aria-label="Changes scope"]') === scopeBar && scopeBar.getBoundingClientRect().top === scopeTop && !document.querySelector('[title="changed.txt"]')
  resolveStaged?.(new Response(JSON.stringify({ isGit: true, branch: "main", files: [], additions: 0, deletions: 0 })))
  await wait(() => document.body.textContent?.includes("No staged changes") === true)
  ;(Array.from(scopeBar.querySelectorAll("button")).find(button => button.textContent === "All"))?.click()
  await wait(() => !!document.querySelector('[title="changed.txt"]'))
  ;(document.querySelector('[title="changed.txt"]') as HTMLElement)?.click()
  results.workingDiffWrapsByDefault = await wait(() => !!document.querySelector(".noa-code-view.is-wrapped")) && (() => { const body = document.querySelector<HTMLElement>(".noa-panel-body")!, code = document.querySelector<HTMLElement>(".noa-code-line.is-add code")!; return body.scrollWidth <= body.clientWidth + 1 && code.getBoundingClientRect().height > 40 })()
  ;(Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label="Diff layout"] button')).find(button => button.textContent === "Split"))?.click()
  results.splitDiffWraps = await wait(() => !!document.querySelector(".noa-code-view.is-split")) && (() => { const body = document.querySelector<HTMLElement>(".noa-panel-body")!, code = document.querySelector<HTMLElement>(".noa-code-line.is-add code")!; return body.scrollWidth <= body.clientWidth + 1 && code.getBoundingClientRect().height > 40 })()
  ;(document.querySelector('[aria-label="Review actions"]') as HTMLElement)?.click()
  ;(Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Stage file"))?.click()
  const actionFailed = await wait(() => !!document.querySelector('[role="alert"]')?.textContent?.includes("Fixture action failed"))
  await new Promise(resolve => setTimeout(resolve, 3200))
  results.actionErrorSurvivesPolling = actionFailed && !!document.querySelector('[role="alert"]')?.textContent?.includes("Fixture action failed")
  failChanges = true
  await show(<div style={{ height: 500 }}><WorkspaceFiles key="error" cwd="/fixture" changes refreshKey={0} onReference={() => {}} /></div>)
  results.changesError = await wait(() => !!document.querySelector('[role="alert"]')?.textContent?.includes("Fixture failure")) && !document.body.textContent?.includes("Loading changes…")
  window.fetch = originalFetch
  const reviewDiff = { files: [{ path: "a.txt", additions: 1, deletions: 0 }, { path: "b.txt", additions: 1, deletions: 0 }], additions: 2, deletions: 0, patch: "--- a/a.txt\n+++ b/a.txt\n@@ -0,0 +1,1 @@\n+a\n--- a/b.txt\n+++ b/b.txt\n@@ -0,0 +1,1 @@\n+b\n" } as any
  await show(<TurnReview diff={reviewDiff} focusPath="a.txt" focusKey={1} />)
  ;(document.querySelector('[role="option"][title="b.txt"]') as HTMLElement)?.click()
  await show(<TurnReview diff={{ ...reviewDiff }} focusPath="a.txt" focusKey={1} />)
  results.turnReviewKeepsSelection = document.querySelector('[role="option"][title="b.txt"]')?.getAttribute("aria-selected") === "true"
  await show(<TurnReview diff={{ ...reviewDiff }} focusPath="a.txt" focusKey={2} />)
  results.turnReviewFocusRequest = document.querySelector('[role="option"][title="a.txt"]')?.getAttribute("aria-selected") === "true"
  const longDiff = { ...reviewDiff, files: [reviewDiff.files[0]], patch: `--- a/a.txt\n+++ b/a.txt\n@@ -0,0 +1,1 @@\n+${"long_identifier_".repeat(80)}\n` }
  localStorage.setItem("noa-turn-diff-wrap", "false")
  localStorage.removeItem("noa-turn-diff-wrap-v2")
  await show(<div style={{ width: 320, height: 400 }}><TurnReview diff={longDiff} /></div>)
  const reviewBody = document.querySelector<HTMLElement>(".noa-panel-body")!
  results.turnDiffWrapsByDefault = !!document.querySelector(".noa-code-view.is-wrapped") && reviewBody.scrollWidth <= reviewBody.clientWidth + 1
  const markedPatch = "--- a/a.ts\n+++ b/a.ts\n@@ -10,1 +10,1 @@\n-oldValue\n+newValue\n"
  await show(<div style={{ width: 320, height: 400 }}><CodeView path="a.ts" content={markedPatch} diff wrap /></div>)
  const addedRow = document.querySelector<HTMLElement>(".noa-code-line.is-add")!, removedRow = document.querySelector<HTMLElement>(".noa-code-line.is-remove")!
  results.diffSingleGutter = addedRow.querySelectorAll(".noa-code-number").length === 1 && removedRow.querySelectorAll(".noa-code-number").length === 1 && addedRow.querySelector(".noa-code-number")?.textContent === "10" && removedRow.querySelector(".noa-code-number")?.textContent === "10"
  results.diffMarkers = getComputedStyle(addedRow.querySelector(".noa-code-number")!, "::before").width === "3px" && getComputedStyle(removedRow.querySelector(".noa-code-number")!, "::before").width === "3px"
  const originalSocket = window.WebSocket
  const requests: any[] = []
  let contextSocket: any
  class ContextSocket {
    static OPEN = 1
    readyState = 1
    onopen?: () => void
    onmessage?: (event: any) => void
    constructor() { contextSocket = this; queueMicrotask(() => this.onopen?.()) }
    send(raw: string) { requests.push(JSON.parse(raw)) }
    close() { this.readyState = 3 }
  }
  window.WebSocket = ContextSocket as any
  await show(<ContextProbe />)
  await wait(() => requests.some(r => r.request?.subtype === "initialize"))
  const reply = (id: string, response: any) => contextSocket.onmessage?.({ data: JSON.stringify({ kind: "agent", message: { type: "control_response", response: { subtype: "success", request_id: id, response } } }) })
  reply(requests.find(r => r.request?.subtype === "initialize").request_id, { models: [], commands: [] })
  await wait(() => requests.some(r => r.request?.subtype === "get_context_usage"))
  const firstContext = requests.find(r => r.request?.subtype === "get_context_usage")
  contextSocket.onmessage?.({ data: JSON.stringify({ kind: "agent", message: { type: "result", subtype: "success", parent_tool_use_id: null, is_error: false, duration_ms: 1 } }) })
  reply(firstContext.request_id, { totalTokens: 10, maxTokens: 100, percentage: 10 })
  results.contextRefreshAfterPending = await wait(() => requests.filter(r => r.request?.subtype === "get_context_usage").length === 2)
  await show(null)
  window.WebSocket = originalSocket
  const panelFetch = window.fetch
  let panelFile = "deleted.txt"
  const diffRequests: URL[] = []
  window.fetch = async (input: any) => {
    const url = new URL(String(input), location.href)
    const file = { path: panelFile, status: panelFile === "deleted.txt" ? " D" : " M", additions: 0, deletions: 1, binary: false }
    if (url.pathname === "/api/changes") return Response.json({ isGit: true, branch: "main", files: url.searchParams.get("scope") === "staged" ? [] : [file], additions: 0, deletions: 1 })
    if (url.pathname === "/api/files") return Response.json({ entries: panelFile === "deleted.txt" ? [] : [{ name: panelFile, path: panelFile, directory: false }], truncated: false })
    if (url.pathname === "/api/diff") { diffRequests.push(url); return Response.json({ content: "--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-old\n+new\n", snapshot: "snapshot" }) }
    if (url.pathname === "/api/file") return Response.json({ kind: "text", content: "file", revision: "revision" })
    return panelFetch(input)
  }
  localStorage.setItem("noa-diff-layout", "unified")
  await show(<WorkspacePanelProbe />)
  await wait(() => !!document.querySelector('[aria-label="Changes scope"]'))
  ;(Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label="Changes scope"] button')).find(button => button.textContent === "Staged"))?.click()
  await wait(() => document.body.textContent?.includes("No staged changes") === true)
  ;(document.querySelector('[data-tab="files"]') as HTMLElement)?.click()
  await wait(() => !!document.querySelector('#panel-files [title="deleted.txt"]'))
  ;(document.querySelector('#panel-files [title="deleted.txt"]') as HTMLElement)?.click()
  results.deletedOpensAllChanges = await wait(() => diffRequests.some(url => url.searchParams.get("path") === "deleted.txt" && url.searchParams.get("scope") === "all"))
  await show(null)
  panelFile = "tracked.ts"
  localStorage.setItem("noa-diff-layout", "unified")
  await show(<WorkspacePanelProbe />)
  await wait(() => !!document.querySelector('#panel-changes [title="tracked.ts"]'))
  ;(document.querySelector('#panel-changes [title="tracked.ts"]') as HTMLElement)?.click()
  await wait(() => !!document.querySelector('#panel-changes [aria-label="Diff layout"]'))
  ;(Array.from(document.querySelectorAll<HTMLButtonElement>('#panel-changes [aria-label="Diff layout"] button')).find(button => button.textContent === "Split"))?.click()
  await wait(() => localStorage.getItem("noa-diff-layout") === "split")
  ;(document.querySelector('[data-tab="files"]') as HTMLElement)?.click()
  await wait(() => !!document.querySelector('#panel-files [title="tracked.ts"]'))
  ;(document.querySelector('#panel-files [title="tracked.ts"]') as HTMLElement)?.click()
  await wait(() => !!Array.from(document.querySelectorAll('#panel-files button')).find(button => button.textContent === "Wrap"))
  ;(Array.from(document.querySelectorAll<HTMLButtonElement>('#panel-files button')).find(button => button.textContent === "Wrap"))?.click()
  await new Promise(requestAnimationFrame)
  await new Promise(requestAnimationFrame)
  results.fileWrapKeepsDiffLayout = localStorage.getItem("noa-diff-layout") === "split"
  await show(null)
  window.fetch = panelFetch
  const largePatch = `--- a/large.txt\n+++ b/large.txt\n@@ -0,0 +1,3001 @@\n${"+line\n".repeat(3001)}`
  await show(<CodeView path="large.txt" content={largePatch} diff hunkScope="unstaged" onHunkAction={() => {}} />)
  results.truncatedHunkHasNoActions = !!document.querySelector(".noa-diff-hunk") && !document.querySelector('[aria-label="Stage hunk 1"]')
  await show(<div><ToolCard block={mcp} defaultOpen /><ToolCard block={todo} defaultOpen /><ToolCard block={{ ...update, name: "Hook", input: { hook_name: "Validation" }, status: "error", output: "Hook failure details" }} defaultOpen /></div>)
  results.mcpVisible = document.getElementById("root")!.textContent!.includes("rows") && document.getElementById("root")!.textContent!.includes("Raw result")
  results.todoVisible = document.getElementById("root")!.textContent!.includes("Inspect files") && !!document.querySelector('[aria-label="in progress"]')
  results.hookVisible = document.getElementById("root")!.textContent!.includes("Hook failure details")
  await show(<Comparison />)
  ;(document.querySelector('[data-case="citation"] button[title]') as HTMLElement)?.click()
  await wait(() => !results.referenceRange || document.querySelectorAll('[data-reference-line="true"]').length === 3)
  await document.fonts.ready
  window.scrollTo(0, 0)
  await new Promise(requestAnimationFrame)
  return results
}
window.mountLightbox = async () => {
  const canvas = document.createElement("canvas"); canvas.width = 240; canvas.height = 120
  const context = canvas.getContext("2d")!; context.fillStyle = "#e5ece1"; context.fillRect(0, 0, 240, 120)
  context.fillStyle = "#355d3d"; context.font = "18px system-ui"; context.fillText("Local image preview", 26, 64)
  await show(<Lightbox items={[{ src: canvas.toDataURL(), name: "preview.png" }]} index={0} onIndex={() => {}} onClose={() => root.render(null)} />)
  await wait(() => document.activeElement?.getAttribute("aria-label") === "Close")
}
window.mountWorkspaceVisual = async () => {
  const originalFetch = window.fetch
  window.fetch = async (input: any) => {
    const url = new URL(String(input), location.href)
    if (url.pathname === "/api/changes") return new Response(JSON.stringify({ error: "Repository unavailable" }), { status: 500 })
    return originalFetch(input)
  }
  await show(<><ThemeInjector settings={{ ...defaultSettings, appearance: { ...defaultSettings.appearance, theme: visualTheme } }} /><div style={{ height: 420, width: 420, border: "1px solid var(--divider-subtle)", background: "var(--surface-page)" }}><WorkspaceFiles cwd="/fixture" changes refreshKey={0} onReference={() => {}} /></div></>)
  await wait(() => !!document.querySelector('[role="alert"]'))
  window.fetch = originalFetch
}
window.mountNavigation = async () => {
  const turns = Array.from({ length: 8 }, (_, i) => [{ role: "user", id: `p${i}`, text: `Prompt ${i}` }, { role: "assistant", id: `a${i}`, streaming: false, blocks: [{ kind: "text", done: true, text: (`Reply ${i}\n\n`).repeat(10) }] }]).flat() as any
  await show(<><div style={{ display: "flex", height: 360 }}><MessageList turns={turns} busy={false} readingWidth={800} sessionId="keyboard-check" /></div><textarea id="navigation-composer" aria-label="Task instruction" /></>)
  await wait(() => document.querySelector('[data-message-rail-item="p7"]')?.getAttribute("aria-current") === "true")
  document.getElementById("navigation-composer")!.focus()
}
window.navigationState = () => ({ id: document.querySelector('[data-message-rail-item][aria-current="true"]')?.getAttribute("data-message-rail-item"), top: document.querySelector(".noa-agent-scroll")?.scrollTop })

window.runLifecycleChecks = async () => {
  const tool = (id: string, name: string, status = "done", input = {}) => ({ kind: "tool", id, name, status, input, partialJson: "" })
  const diff = { files: ["gui/src/components/Markdown.tsx", "gui/src/components/RichContent.tsx", "gui/src/components/markdownGrammar.ts"].map((path, i) => ({ path, additions: [24, 5, 19][i], deletions: [10, 2, 4][i] })), additions: 48, deletions: 16, turnIndex: 0 } as any
  const turns = [{ role: "user", id: "fold-u", text: "Inspect and edit files" }, { role: "assistant", id: "fold-a", streaming: false, durationMs: 923000, blocks: [
    { kind: "thinking", text: "Inspect the component", done: true }, tool("failed", "Bash", "error", { command: "first check" }),
    { kind: "text", text: "The first check failed. Fixing the component.", done: true }, tool("edit", "Edit", "done", { file_path: "Markdown.tsx", old_string: "before", new_string: "after" }),
    { ...tool("image", "Read", "done", { file_path: "screenshot.png" }), images: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=" } }] },
    { ...todo, id: "snapshot" }, { kind: "text", text: "All changes verified.", done: true },
  ], diff }] as any
  let opened: string | undefined, action = ""
  const transcript = <div style={{ height: 520 }}><MessageList turns={turns} busy={false} readingWidth={800} onTurnDiff={(_diff, path) => { opened = path ?? "all" }} onTurnDiffAction={(_diff, value) => { action = value }} /></div>
  const child = { role: "assistant", id: "child", streaming: true, blocks: [{ kind: "thinking", text: "Still thinking", done: false }, tool("child-read", "Read", "running")] }
  const state: any = { ...initialState, tasks: [{ id: "done", description: "Finished child", status: "running", turns: [child] }, { id: "live", description: "Real background task", status: "running", turns: [child] }] }
  const terminal = reducer(state, { type: "agent", message: { type: "system", subtype: "task_notification", task_id: "done", status: "completed" } } as any)
  const finished = terminal.tasks.find((task: any) => task.id === "done")!, background = terminal.tasks.find((task: any) => task.id === "live")!
  const picture = <><ThemeInjector settings={{ ...defaultSettings, appearance: { ...defaultSettings.appearance, theme: visualTheme } }} /><div className="grid">
    {panel("fold", "Completed edit turn · defaults", transcript)}
    {panel("done-todo", "Finished turn · historical in-progress checklist", <ToolCard block={todo} defaultOpen active={false} />)}
    {panel("finished-child", "Completed child · no live animation", <ToolCard block={tool("done", "Agent", "running") as any} task={finished} tasks={terminal.tasks} defaultOpen />)}
    {panel("background", "Genuine background task · still running", <ToolCard block={tool("live", "Agent") as any} task={background} tasks={terminal.tasks} defaultOpen />)}
    {panel("diff-card", "Editing completed · change summary", <TurnDiffCard diff={diff} onOpen={path => { opened = path ?? "all" }} onAction={value => { action = value }} />)}
  </div></>
  await show(null); await show(picture)
  const scope = (id: string) => document.querySelector(`[data-case="${id}"]`)!
  const checks: Record<string, boolean> = {}
  checks.recoveredFailureFolds = !scope("fold").textContent!.includes("The first check failed") && scope("fold").textContent!.includes("All changes verified")
  checks.processImageFolds = !scope("fold").querySelector('[data-tool-activity="image"]')
  checks.processChecklistFolds = !scope("fold").querySelector('[aria-label="Task checklist"]')
  checks.completedTodoStops = !scope("done-todo").querySelector(".noa-shimmer")
  checks.completedChildStops = !scope("finished-child").querySelector(".noa-shimmer,.noa-status-running") && finished.turns.every((turn: any) => !turn.streaming)
  checks.backgroundContinues = !!scope("background").querySelector(".noa-shimmer,.noa-status-running") && background.status === "running" && scope("background").getAnimations({ subtree: true }).some(animation => animation.playState === "running")
  const buttons = Array.from(scope("diff-card").querySelectorAll("button"))
  const view = buttons.find(b => b.textContent === "View changes")
  checks.completedDiffActionVisible = !!view && getComputedStyle(view).display !== "none" && scope("diff-card").querySelectorAll(".noa-turn-diff-row").length === 3
  view?.click(); checks.viewChangesOpens = opened === "all"
  ;(scope("diff-card").querySelectorAll(".noa-turn-diff-row")[1] as HTMLElement)?.click(); checks.diffFileOpens = opened === diff.files[1].path
  buttons.find(b => b.title === "Undo")?.click()
  checks.undoNeedsConfirmation = await wait(() => !!document.querySelector('[role="dialog"]')) && action === ""
  const confirm = Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === "Undo changes") as HTMLElement | undefined
  confirm?.click(); checks.undoAfterConfirmation = await wait(() => action === "undo")
  const worked = Array.from(scope("fold").querySelectorAll("button")).find(b => b.textContent!.includes("Worked for"))
  worked?.click()
  checks.expandRestoresProcess = await wait(() => scope("fold").textContent!.includes("The first check failed")) && !!scope("fold").querySelector('[data-tool-activity="image"]')
  checks.expandedHistoryStops = !scope("fold").querySelector(".noa-shimmer,.noa-status-running")
  worked?.click()
  await show(null)
  const imageTurns = (active: boolean) => turns.map((turn: any) => turn.role === "assistant" ? { ...turn, streaming: active } : turn)
  await show(<div style={{ display: "flex", height: 520 }}><MessageList turns={imageTurns(true)} busy readingWidth={800} /></div>)
  ;(document.querySelector('[aria-label="Open Tool result image 1"]') as HTMLElement)?.click()
  const viewerOpened = await wait(() => !!document.querySelector("dialog[open]"))
  await show(<div style={{ display: "flex", height: 520 }}><MessageList turns={imageTurns(false)} busy={false} readingWidth={800} /></div>)
  checks.imageViewerSurvivesCompletion = viewerOpened && !!document.querySelector("dialog[open]") && !document.querySelector('[data-tool-activity="image"]')
  window.mountLifecycle = async () => { await show(null); await show(picture) }
  await window.mountLifecycle()
  return checks
}

window.runVisualChecks = async () => {
  const diff = { files: ["gui/src/components/Markdown.tsx", "gui/src/components/RichContent.tsx", "gui/src/components/markdownGrammar.ts"].map((path, i) => ({ path, additions: [24, 5, 19][i], deletions: [10, 2, 4][i] })), additions: 48, deletions: 16, turnIndex: 0 } as any
  const edit = { kind: "tool", id: "visual-edit", name: "Edit", input: { file_path: "src/components/long-directory-name/ConversationRendering.tsx", old_string: "const value = 1", new_string: "const value = 2\nreturn value" }, partialJson: "", status: "done" } as any
  const code = "```ts\n// Syntax should remain readable in both themes.\nconst pattern = /conversation/gi;\nconst title = 'Rendering';\nfunction render(value: number) { return value + 42 }\n```"
  const permission = { requestId: "visual-permission", toolName: "Edit", input: edit.input, suggestions: [] }
  let approvalAnswers = 0
  window.approvalAnswerCount = () => approvalAnswers
  await show(null)
  await show(<><ThemeInjector settings={{ ...defaultSettings, appearance: { ...defaultSettings.appearance, theme: visualTheme } }} /><div className="grid" data-visual-matrix>
    {panel("visual-diff", "Completed edit card", <TurnDiffCard diff={diff} onOpen={() => {}} onAction={() => {}} />)}
    {panel("diff-without-undo", "Narrow multi-file card", <div style={{ width: 280 }}><TurnDiffCard diff={diff} onOpen={() => {}} /></div>)}
    {panel("diff-wide", "Wide multi-file card", <div style={{ width: 520, maxWidth: "100%" }}><TurnDiffCard diff={diff} onOpen={() => {}} onAction={() => {}} /></div>)}
    {panel("diff-pending", "Pending reapply card", <div style={{ width: 321 }}><TurnDiffCard diff={{ ...diff, reverted: true }} onOpen={() => {}} onAction={() => {}} pending /></div>)}
    {panel("visual-tools", "Tool details and terminal state", <><ToolCard block={edit} defaultOpen /><ToolCard block={{ ...edit, id: "visual-error", name: "Bash", input: { command: "bun test" }, status: "error", output: "Validation failed: fixture error" }} defaultOpen /></>)}
    {panel("visual-code", "Highlighted code", <Markdown text={code} />)}
    {panel("visual-prose", "Text, table, formula and references", <Markdown text={"### Conversation rendering\n\nReadable **strong text**, `inline code`, [a reference](https://example.com), and \\(x^2 + y^2\\).\n\n> A quoted observation.\n\n| State | Result |\n| --- | --- |\n| Completed | No animation |\n| Background | Still running |\n\n- First item\n- Second item"} />)}
    {panel("visual-approval", "Pending edit approval", <PermissionCard permission={permission} onAnswer={() => { approvalAnswers++ }} />)}
    {panel("visual-diagram", "Theme-aware diagram", <Markdown text={"```mermaid\ngraph LR\nA[Protocol event] --> B[State] --> C[Rendered message]\n```"} />)}
    {panel("visual-file", "File viewer", <div className="noa-panel-body" style={{ maxHeight: 200 }}><CodeView path="a.ts" content={"// Syntax should remain readable\nconst pattern = /conversation/gi;\nconst title = 'Rendering';\nfunction render(value: number) { return value + 42 }"} /></div>)}
  </div></>)
  await wait(() => !!document.querySelector('[data-case="visual-code"] .hljs-regexp'))
  await wait(() => !!document.querySelector('[data-case="visual-diagram"] svg .node rect'), 5000)
  const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
  const colors = { page: style("body").backgroundColor, text: style("body").color, regex: style('[data-case="visual-code"] .hljs-regexp').color, fileRegex: style('[data-case="visual-file"] .hljs-regexp').color, toolAdded: style('[data-case="visual-tools"] .text-\\[\\#168447\\]').color, cardAdded: style('[data-case="visual-diff"] .is-added').color }
  const cardSize = { title: style(".noa-turn-diff-heading > span").fontSize, total: style(".noa-turn-diff-header .noa-turn-diff-stats").fontSize, row: style(".noa-turn-diff-row").fontSize, rowStats: style(".noa-turn-diff-row .noa-turn-diff-stats").fontSize, iconWidth: style(".noa-turn-diff-icon").width, headerHeight: document.querySelector(".noa-turn-diff-headrow")!.getBoundingClientRect().height }
  const diagram = document.querySelector('[data-case="visual-diagram"] svg .node rect')
  window.visualMetrics = { theme: visualTheme, colors, cardSize, diagramFill: diagram ? getComputedStyle(diagram).fill : null }
  return {
    narrowDiffWithoutUndo: (() => { const card = document.querySelector('[data-case="diff-without-undo"] .noa-turn-diff-card')!; const title = card.querySelector<HTMLElement>(".noa-turn-diff-heading > span")!; const view = card.querySelector<HTMLElement>(".noa-turn-diff-view")!; return title.clientWidth >= 100 && view.getBoundingClientRect().top >= title.getBoundingClientRect().bottom && view.getBoundingClientRect().right <= card.getBoundingClientRect().right })(),
    wideDiffSingleRow: (() => { const card = document.querySelector('[data-case="diff-wide"] .noa-turn-diff-card')!; const header = card.querySelector<HTMLElement>(".noa-turn-diff-header")!; const view = card.querySelector<HTMLElement>(".noa-turn-diff-view")!; return view.getBoundingClientRect().top < header.getBoundingClientRect().bottom && view.getBoundingClientRect().right <= card.getBoundingClientRect().right })(),
    pendingDiffTitleReadable: (() => { const card = document.querySelector<HTMLElement>('[data-case="diff-pending"] .noa-turn-diff-card')!; const title = card.querySelector<HTMLElement>(".noa-turn-diff-heading > span")!; const passed = [321, 360, 400, 440, 441, 460].every(width => { card.parentElement!.style.width = `${width}px`; return title.clientWidth >= 100 }); card.parentElement!.style.width = "321px"; return passed })(),
    codeBorder: style('[data-case="visual-code"] .noa-code-block').borderTopWidth === "1px" && style('[data-case="visual-code"] .noa-code-block').borderTopColor === (visualTheme === "dark" ? "rgba(255, 255, 255, 0.06)" : "rgba(13, 13, 13, 0.05)"),
    diffHairline: style('[data-case="visual-diff"] .noa-turn-diff-card').boxShadow.includes("0.5px") && style('[data-case="visual-diff"] .noa-turn-diff-card').borderTopWidth === "0px",
    themeSurface: colors.page === (visualTheme === "dark" ? "rgb(45, 45, 43)" : "rgb(249, 249, 247)"),
    themeText: colors.text === (visualTheme === "dark" ? "rgb(249, 249, 247)" : "rgb(45, 45, 43)"),
    diffTotalTypography: parseFloat(cardSize.total) === parseFloat(cardSize.title) - 1,
    diffRowTypography: cardSize.rowStats === cardSize.row,
    toolStatsTheme: colors.toolAdded === colors.cardAdded,
    regexTheme: colors.regex === "rgb(0, 200, 83)" && colors.fileRegex === colors.regex,
    externalLinkTheme: style('[data-case="visual-prose"] a').color === "rgb(204, 125, 94)",
    formulaAndTable: !!document.querySelector('[data-case="visual-prose"] .katex') && !!document.querySelector('[data-case="visual-prose"] table'),
    diagramRendered: !!diagram,
    approvalTheme: !!document.querySelector('[data-tool-approval]') && style('[data-tool-approval]').color === colors.text,
  }
}
window.checkNarrowVisual = async () => {
  await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
  const card = document.querySelector('[data-case="visual-diff"]')!
  const bounds = card.getBoundingClientRect()
  window.narrowMetrics = { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, card: { left: bounds.left, right: bounds.right }, overflow: Array.from(document.querySelectorAll("[data-visual-matrix] *")).flatMap(element => { const rect = element.getBoundingClientRect(); return rect.right > innerWidth + 1 && getComputedStyle(element).position !== "absolute" ? [{ tag: element.tagName, className: element.className, right: rect.right }] : [] }).slice(0, 12) }
  return Array.from(card.querySelectorAll("button")).every(button => { const rect = button.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right }) && document.documentElement.scrollWidth <= innerWidth
}

window.mountBoundaryApp = async () => {
  await show(null)
  const session = "30000000-0000-4000-8000-000000000003"
  const diff = { files: [{ path: "src/a-very-long-directory-name/ConversationRendering.tsx", additions: 48, deletions: 16 }], additions: 48, deletions: 16, turnIndex: 1 }
  const history: any[] = [{ kind: "user", id: "boundary-user", text: "Inspect rendering boundaries, long paths and long content. " + "LongIdentifier".repeat(30) },
    { kind: "agent", message: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "edit-boundary", name: "Edit", input: { file_path: diff.files[0]!.path, old_string: "before", new_string: "after" } }] } } },
    { kind: "agent", message: { type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "edit-boundary", content: "Edited successfully" }] } } },
    { kind: "agent", message: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "### Rendering verified\n\n" + "LongContent".repeat(60) + "\n\n```sh\n" + "very-long-command ".repeat(35) + "\n```\n\n| State | Result |\n| --- | --- |\n| Completed | No overlap |\n\nFinal answer remains reachable above the composer." }] } } },
    { kind: "turn-duration", durationMs: 12000 }, { kind: "turn-diff", diff }]
  localStorage.clear()
  localStorage.setItem("noa-agent.appearance", JSON.stringify({ ...defaultSettings.appearance, theme: visualTheme }))
  localStorage.setItem("noa-agent.current", JSON.stringify({ cwd: "/fixture", resume: session, runtimeId: "40000000-0000-4000-8000-000000000004" }))
  window.fetch = async (input: any) => {
    const url = new URL(String(input), location.href)
    const body = url.pathname === "/api/info" ? { cwd: "/fixture" } : url.pathname === "/api/projects" ? [{ path: "/fixture", name: "Long project title for boundary verification", sources: ["/fixture"], missing: false }] : url.pathname === "/api/sessions" ? [{ id: session, title: "Long task title for boundary verification ".repeat(5), updatedAt: 1 }] : url.pathname === "/api/runs" ? [] : url.pathname === "/api/files" ? { entries: [] } : url.pathname === "/api/changes" ? { files: [], additions: 0, deletions: 0, branch: "main", isGit: true } : {}
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
  }
  class BoundarySocket {
    static OPEN = 1
    readyState = 1
    onopen?: () => void
    onmessage?: (event: any) => void
    constructor() { window.boundarySocket = this; queueMicrotask(() => this.onopen?.()) }
    send(raw: string) {
      const message = JSON.parse(raw)
      if (message.type !== "control_request") return
      queueMicrotask(() => {
        const emit = (payload: any) => this.onmessage?.({ data: JSON.stringify(payload) })
        if (message.request.subtype === "initialize") {
          emit({ kind: "agent", message: { type: "system", subtype: "init", session_id: session, model: "fixture", permissionMode: "default" } })
          emit({ kind: "history", items: history })
        }
        emit({ kind: "agent", message: { type: "control_response", response: { subtype: "success", request_id: message.request_id, response: { models: [], commands: [], model: "fixture", totalTokens: 0, maxTokens: 200000, percentage: 0 } } } })
      })
    }
    close() { this.readyState = 3 }
  }
  window.WebSocket = BoundarySocket as any
  document.body.style.padding = "0"
  document.body.style.overflow = "hidden"
  document.getElementById("background")!.hidden = true
  await show(<App cwd="/fixture" />)
  await wait(() => !!document.querySelector(".noa-turn-diff-card"), 3000)
}
window.inspectAppBoundary = async () => {
  await new Promise(resolve => setTimeout(resolve, 650))
  const scroller = document.querySelector<HTMLElement>(".noa-agent-scroll")!
  scroller.scrollTop = scroller.scrollHeight
  await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
  const footer = document.querySelector(".noa-conversation-footer")!.getBoundingClientRect()
  const card = document.querySelector(".noa-turn-diff-card")!.getBoundingClientRect()
  const response = document.querySelector("[data-response-content]")!.getBoundingClientRect()
  const shell = document.querySelector(".noa-app-shell")!.getBoundingClientRect()
  const input = document.querySelector('[aria-label="Task instruction"]')!.getBoundingClientRect()
  const header = document.querySelector(".noa-turn-diff-headrow")!
  const tabs = document.querySelector('[aria-label="Panel tabs"]')!.getBoundingClientRect()
  const toggle = document.querySelector('[aria-label="Right panel"]')!.getBoundingClientRect()
  const tablist = document.querySelector('[aria-label="Panel tabs"]')!
  tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))
  await new Promise(requestAnimationFrame)
  const activity = document.querySelector('[data-tab="activity"]')!
  const reachable = activity.getAttribute("aria-selected") === "true" && activity.getBoundingClientRect().right <= tabs.right + 1
  tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }))
  await new Promise(requestAnimationFrame)
  const checks = { panelTabScrollbarHidden: getComputedStyle(tablist).scrollbarWidth === "none", panelTabKeyboardReachable: reachable, panelTabsClearOfToggle: tabs.right <= toggle.left - 7, horizontalContentContained: scroller.scrollWidth <= scroller.clientWidth + 1, diffAboveComposer: card.bottom <= footer.top + 33, answerAboveComposer: response.bottom <= footer.top + 33, composerInsideWindow: input.bottom <= innerHeight && input.left >= 0 && input.right <= innerWidth, controlsInsideCard: Array.from(header.querySelectorAll("button")).every(button => button.getBoundingClientRect().right <= card.right + 1), shellInsideWindow: shell.width <= innerWidth && shell.height <= innerHeight }
  return { width: innerWidth, theme: visualTheme, checks, pass: Object.values(checks).every(Boolean), sizes: { contentWidth: scroller.clientWidth, contentScrollWidth: scroller.scrollWidth, footerTop: footer.top, cardBottom: card.bottom, responseBottom: response.bottom } }
}

window.inspectPendingBoundary = async () => {
  const emit = (message: any) => window.boundarySocket.onmessage({ data: JSON.stringify({ kind: "agent", message }) })
  emit({ type: "control_request", request_id: "large-approval", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "echo validating boundary\n".repeat(80) }, tool_use_id: "pending-command" } })
  emit({ type: "control_request", request_id: "large-elicitation", request: { subtype: "elicitation", mcp_server_name: "local", mode: "form", message: "Choose a validation mode", requested_schema: { type: "object", properties: { mode: { type: "string", enum: ["All", "Focused"] } } } } })
  await wait(() => !!document.querySelector("[data-tool-approval]"))
  const input = document.querySelector<HTMLTextAreaElement>('[aria-label="Task instruction"]')!
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "A long instruction draft\n".repeat(20))
  input.dispatchEvent(new Event("input", { bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 200))
  const footer = document.querySelector(".noa-conversation-footer")!.getBoundingClientRect()
  const titlebar = document.querySelector("[data-titlebar]")!.getBoundingClientRect()
  const pending = document.querySelector("[data-tool-approval]")!.parentElement!
  const approval = document.querySelector<HTMLButtonElement>('[title="Allow once (Enter)"]')!
  approval.focus()
  await new Promise(requestAnimationFrame)
  const region = pending.getBoundingClientRect()
  const approvalRect = approval.getBoundingClientRect()
  const approvalActionReachable = approvalRect.top >= region.top - 1 && approvalRect.bottom <= region.bottom + 1
  pending.scrollTop = pending.scrollHeight
  await new Promise(requestAnimationFrame)
  const continuation = Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Continue")!
  const formRect = continuation.getBoundingClientRect()
  const formActionReachable = formRect.top >= region.top - 1 && formRect.bottom <= region.bottom + 1
  const inputRect = input.getBoundingClientRect()
  const checks = { composerViewportLimit: inputRect.height <= innerHeight * .25 + 1, noTitlebarOverlap: footer.top >= titlebar.bottom - 1, composerVisible: inputRect.top >= titlebar.bottom && inputRect.bottom <= innerHeight, approvalActionReachable, formActionReachable, draftPreserved: input.value.split("A long instruction draft").length === 21 }
  return { pass: Object.values(checks).every(Boolean), checks, footerTop: footer.top, titlebarBottom: titlebar.bottom, footerHeight: footer.height, inputHeight: inputRect.height }
}

window.approvalCardRect = () => {
  const rect = document.querySelector('[data-case="visual-approval"]')!.getBoundingClientRect()
  return { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) }
}
window.prepareApprovalPreview = async () => {
  const trigger = document.querySelector<HTMLElement>('[data-case="visual-approval"] [aria-label^="Preview proposed changes"]')!
  trigger.scrollIntoView({ block: "center", behavior: "instant" })
  trigger.focus({ preventScroll: true })
  await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
  const rect = trigger.getBoundingClientRect()
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
}
window.runApprovalPreviewChecks = async () => {
  const trigger = document.querySelector<HTMLButtonElement>('[data-case="visual-approval"] [aria-label^="Preview proposed changes"]')
  if (!trigger) return { approvalSummary: false, approvalPreviewVisible: false, approvalPreviewBounds: false, approvalPreviewDiff: false, previewEscapeDoesNotApproveOrDeny: false }
  const scope = document.querySelector('[data-case="visual-approval"]')!
  const summary = !scope.querySelector("pre") && scope.textContent!.includes("+2") && scope.textContent!.includes("-1")
  const opened = await wait(() => !!document.querySelector('[data-approval-diff-preview]:popover-open'), 1500)
  const preview = document.querySelector<HTMLElement>("[data-approval-diff-preview]")
  const painted = await wait(() => !!preview?.isConnected && getComputedStyle(preview).opacity === "1" && preview.getAnimations().every(animation => animation.playState !== "running"), 600)
  const rect = preview?.getBoundingClientRect()
  const diff = !!preview && preview.querySelectorAll(".noa-code-line.is-add").length === 2 && preview.querySelectorAll(".noa-code-line.is-remove").length === 1
  const checks = { approvalSummary: summary, approvalPreviewVisible: opened && painted, approvalPreviewBounds: !!rect && rect.height > 0 && rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && rect.height <= 420, approvalPreviewDiff: diff, previewEscapeDoesNotApproveOrDeny: false }
  window.checkApprovalResizeDismissal = async () => {
    trigger.blur(); trigger.focus()
    await wait(() => !!document.querySelector("[data-approval-diff-preview]"))
    trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    window.dispatchEvent(new Event("resize"))
    const dismissed = await wait(() => !document.querySelector("[data-approval-diff-preview]"))
    await new Promise(resolve => setTimeout(resolve, 900))
    return dismissed && !document.querySelector("[data-approval-diff-preview]") && window.approvalAnswerCount() === 0
  }
  window.closeApprovalPreview = async () => {
    const close = preview!.querySelector<HTMLButtonElement>('[aria-label="Close diff preview"]')!
    close.focus()
    close.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    await wait(() => !document.querySelector("[data-approval-diff-preview]"))
    await new Promise(resolve => setTimeout(resolve, 900))
    return !document.querySelector("[data-approval-diff-preview]") && window.approvalAnswerCount() === 0
  }
  return checks
}
