# Desktop composer reference

Checked against the locally installed Codex app **26.1021.22027** on 2026-10-24.
The implementation reference is `/Applications/ChatGPT.app/Contents/Resources/app.asar`, not a screenshot estimate.

Relevant bundled assets:

- `webview/assets/app-initial-56db6e0bcb8b.css`: composer layout and attached utility rail.
- `webview/assets/app-shared-fadc3c6ec518.css`: desktop spacing, typography and elevation tokens.
- `webview/assets/app-primary-5fa64a4ee99d.css`: footer label container breakpoints.
- `webview/assets/app-primary-c377f30f532d.js`: utility rail row composition.
- `webview/assets/app-theme-2f97d75039b0.js`: theme-dependent border and surface recipes.

## Applied dimensions

| Element | Desktop value |
| --- | --- |
| Spacing unit | 4px |
| System font stack | -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif |
| UI / dropdown label / medium weight | 430 / 400 / 500 |
| Dropdown control font / line height | 13px / 18px |
| Home heading font / weight / line height | 28px / 400 / 1.2 |
| Multiline corner radius | 22px |
| Empty attachment spacer | 8px top + 6px bottom |
| Input minimum height / line height | 44px / 20px |
| Input font size / horizontal inset | 14px / 12px |
| Input-to-footer gap | 4px |
| Footer buttons | 28px |
| Footer horizontal / bottom inset | 8px / 8px |
| Resulting empty multiline card | 98px |
| Utility rail inline inset | 13px |
| Utility rail top radius / overlap behind card | 16px / 16px |
| Utility rail row | 28px controls + 4px top and bottom |
| Permission / secondary label collapse | Footer container <= 475px / 480px |

The light composer has no layout border. Its edge is the first layer of the elevation shadow:
`0 0 0 1px #0000000a, 0 2px 8px #0000000a, 0 4px 40px 8px #00000006`.
The dark elevation is `inset 0 0 1px #fff3`, using Noa's existing dark surface.

The user's Codex screenshots supply the selected light palette: page `#F9F9F7`,
composer `#FAFAF8`, environment rail `#EEEEEC`. These are sampled flat-area values;
the installed app's default theme is configurable, so its defaults are not a claim
about the user's selected palette. No Codex branding or decorative icon is included.

Noa uses its existing React textarea and stream-json agent bridge. File references,
model/effort selection, permissions and task execution use real backend behavior.
Microphone capture, a terminal emulator and repository publishing are not implemented.

## Project creation and editing

The Create project dialog follows Codex's local-project picker: a segmented project
name field, multiple source folders, a primary folder, an inline Add folder row,
folder drag-and-drop, and the same 520px dialog geometry. Additional folders are
persisted in `gui-projects.json` and passed to the real CLI as `--add-dir`.

Existing projects can be renamed and their additional source folders can be edited
from the project menu. Noa keeps the existing primary folder immutable during edit:
transcripts are keyed by that working directory, so silently changing it would hide
the project's task history. Changing the primary folder is allowed while creating a
new project. Turn changes made through Edit/Write in an additional source are merged
into the turn review; cross-source patches are review-only because Undo must target
one Git worktree.

Anthropic sign-in starts through the CLI's stream-json control channel, opens the
normal browser OAuth page, and accepts the browser redirect or the manual
`code#state` fallback. Third-party provider profile creation and switching remain in
the Noa CLI until their credential/keychain writes have an equivalent GUI flow.

## Verification

From `gui/`: `bun run typecheck`, `bun run build`, `bun run scripts/e2e-workspace.ts`.
The workspace E2E starts real HTTP bridges against temporary Git repositories.
It covers workspace boundaries, file saves, Git mutations, project names and source
folders, session metadata and transcript restoration. `bun run test:bridge` verifies
that additional project folders reach the real CLI as `--add-dir`. Browser-level
layout, menu, draft, file-reference and agent-approval checks are not automated yet.

Sidebar exception requested by the user: retain Noa's original system font stack,
12px inherited text, 400 normal/medium weight and original text color tiers.
Projects start collapsed; task rows have neither timestamps nor document icons.
The Codex sidebar row component (`Jqn` in `app-primary-c377f30f532d.js`) uses
`bg-primary-ghost-hover` for both active and hover states. The fallback radius is 8px;
superellipse support applies Codex's 1.25 radius scale (10px) and `superellipse(1.5)`.
Light highlight fill is sampled from the user's selected Codex palette (`#EAEAE8`);
it is not inferred from the installed app's configurable default theme. The existing
7.8% ink wash is retained for dark mode.
The resizer uses a full-height 1px gradient through 25% ink. All linked position
transitions are disabled during a drag; CU samples recorded matching sidebar and
divider positions at 413, 400, 388, 375 and 363px with transition duration 0s.

The titlebar shows a bounded project/task breadcrumb, reads existing `custom-title`
records, and supports renaming through the same metadata format without modifying
user instructions. The workspace E2E now includes 13 cases, including title metadata,
rename persistence and rejection of empty names.

Project headers and task rows use 29px minimum height with a 1px gap after the
project header. Top and side dividers share 0.5px geometry and the same Noa border
color token. A new task opens a draft page and never inserts an unsent row into
the project list or selects the project header. Project menus sit beside the new
task action. This follows `kur` / `DX` in the installed primary bundle and `F4a`
in the initial bundle, which navigates to the home composer with project context.

The Projects header keeps only Add project, revealed on header hover or focus as
Codex's `V4n` toolbar is. The header New task button was removed because each project
row already carries "Start new chat in" (and ⌘N still starts a task). The project
menu item reads "Remove project", matching `sidebarElectron.removeProject.menuItem.local`.

The project menu adds "Reveal in Finder" (`sidebarElectron.openWorkspaceRootInFinder`) above
a divider, shown only for folders that exist. `POST /api/projects/reveal` opens a path only
when it is a listed project. Codex's other menu items (archive, mark read, pin, edit, sections,
worktree chat, remote connection) have no Noa equivalent and were left out.

Project row actions ("…" menu and "New task in project") are 20px slots with an 8px gap,
matching the `h-5` action grid and `gap-2` wrapper in `wQ` / `eJn`. Neither icon has a
hover background, as in Codex; hover only changes the icon colour.

Sidebar top follows the Codex screenshot: a "New task" row (Codex's "New chat") sits above
Search, and the Projects header is plain body text with a chevron that collapses the project
list. Codex's Projects "…" organize menu was not added: Noa has one grouping and one sort
order, so the menu would hold a single option.

## Right panel (rebuilt)

The right column is one pane under a tab strip (Overview, Files, Changes, Activity) with a
close control, replacing the stacked cards, per-card minimise/expand, move handles and the
titlebar checklist. Tabs follow the WAI-ARIA tablist pattern (`role="tab"`, `aria-selected`,
arrow-key navigation), as Codex's `TabsList` / `TabsTrigger` do. The titlebar toggle shows or
hides the column. Not ported from Codex: tab drag-to-move, detached windows, tab thumbnails.

Overview is not a right-column tab. It is opened from the titlebar button beside the column toggle and
has the two states of Claude's session rail (its bundled frontend was read for the rules and values).
The logic is Claude's: a remembered "shown" preference (default on) plus a width test. The docked column is
visible when it is shown and the chat area is wide enough (611px, or 771px with the right column open):
a 280px column of ring cards, 12px radius, 10px apart, no animation, and the chat and composer make room.
When it does not fit, the column is hidden and the toggle opens a transient flat popover instead (200ms
fade-in, closes on an outside press or Escape). Toggling while docked hides it and clears the preference;
opening the popover sets the preference, so widening later docks it; the popover closes by itself when the
column becomes visible, and a hidden column never turns into a popover. Cards
(Changes totals, Connectors from `mcp_status`, Context, Environment) are collapsible, drag to reorder
from the 80px grip zone at the header's end (6px to start, 200ms shift; the grip's arrow keys also
move them), and a right-click on a header opens Show / Reset to defaults. The context card lists used
categories largest first (top series coloured, the rest one neutral series), buffer and free space,
deferred rows apart, and MCP tools / Memory files / Custom agents lists that the Memory files and
Custom agents rows reveal. Not ported: Create PR, Remote Control, and manage actions for connectors
and skills (Noa has no such screens).

## Agent wiring, first usability batch

UI references were inspected in the installed app's `app-initial-fc48ea5ad55c.js`
and `app-primary-c377f30f532d.js`: queued follow-ups, image attachments and
subagent activity. Noa keeps its existing CLI and stream-json protocol.

- The bridge owns agent processes. Switching tasks or reconnecting the renderer
  detaches/reattaches its subscription; it does not stop a running task. Quitting
  the app stops the bridge and its agents. Detached idle sessions are reclaimed
  and resume in a fresh CLI; running or waiting sessions stay alive.
- Follow-ups queue in the bridge and send on the CLI's authoritative idle event.
  Stop pauses the queue; errors also require an explicit next send. Queue items
  can be removed. Unexpected CLI exits retain queued follow-ups for reconnect. Initialize is shared across concurrent/reconnecting clients.
- Activity consumes task started/progress/completed events and child-agent output,
  retaining the mapping between task IDs and tool-use IDs. Tasks can be stopped.
- MCP form and URL requests have accept/decline/cancel responses. Unsupported
  request kinds receive an explicit error instead of hanging silently.
- PNG/JPEG/GIF/WebP images can be chosen, pasted or dropped, previewed and removed.
  Image drafts use IndexedDB; sent images use base64 blocks through the Noa CLI.
- History uses the CLI's path sanitizer and transcript recovery rules, including
  branches and preserved compact segments. Error results retain their details.

Verification commands from `gui/`: `bun run test` (regression checks),
`bun run test:bridge` (real CLI with a local model/MCP fixture; no paid API),
`bun run typecheck`, and `bun run build`. Existing workspace E2E commands still apply.

## Slash commands

The command popover follows the installed Codex `V5s` / `q5s` presentation:
Commands/Skills groups, icon + single-line title/description, a selected-row
surface, scroll-to-selection, and model/effort/permission submenus. It retains
Noa's existing floating surface, font, palette and elevation.

GUI actions route `/new` (`/clear`, `/reset`), `/resume`, `/model`, `/effort`,
`/permissions`, `/plan`, `/config` (`/settings`), `/context` (`/cost`), `/status`,
`/skills`, `/help` and `/stop` to their existing controls. Native local commands
and prompt skills continue through the CLI. `/reload-plugins` uses the CLI's
reload control and refreshes the command list, including on reconnect.

The CLI's initialize/reload descriptors include optional type, source, aliases
and hidden fields. Terminal-only and hidden/removed commands are excluded from
the GUI menu. Unknown slash names receive local feedback instead of a model call.
Local result text and its transcript wrappers are rendered and restored. Image
blocks precede the final text block so slash skills with images still parse.

Enter selects, Tab completes, arrows navigate, and Escape closes the list before
it can stop a running turn. Skills with arguments stay editable before sending.
Browsing commands from the plus menu preserves an existing text/image draft.

GUI history lookup canonicalizes symlinked project paths to match the CLI. GUI
agents use the existing eager-flush option so completed local commands are
immediately available to history readers.

Turn change cards show workspace snapshots taken during that turn, including concurrent manual or other-task edits. Undo/Reapply lists all affected files and requires confirmation. Snapshot capture, completion and patch actions are serialized per workspace; different projects do not block each other. The bridge refuses patch actions while that workspace has a running or waiting task, and applies the whole patch atomically.

## Message actions, activity, approvals and code typography

Checked against Codex 26.1021.31345 packed assets on 2026-10-25:
`subagent-activity-chip-group-a0fc2223efe0.js`,
`agent-activity-item-row-fa5342a7c173.js`,
`composer-approval-request-card-ef55e8ccb5d5.js`, and the code snippet renderer
in `app-shared-2cae01273bae.js` / `app-shared-bd3e4e649b69.css`.
The reliability pass also inspected its native worker `applyPatch` atomic mode,
per-scope turn-diff finalization, bounded code highlighting, stopped-command
labels and disabled approval actions. Noa keeps its own CLI process lifecycle;
only workspace operation ordering, atomic patches and render boundaries are shared.

Noa has no final-channel flag, so reply actions appear only on the last text run
once the assistant segment finishes. Intermediate commentary has no action row.
Activity headers use zero padding, 16px icons and a 6px icon/text gap. Approval
cards use a neutral bordered surface, 16px header/footer insets and 28px buttons;
permission responses and remembered scopes remain those supplied by Noa.
Code blocks use a 20px corner radius, a 48px UI-font toolbar, icon-only Copy,
12px default code text and line height max(1.5em, 20px). Code font family and size
are independent of the interface font and apply to snippets and workspace diffs.

Worked-for/activity dividers use the same content edges as the answer, with no horizontal inset, an 8px label/rule gap and a full-width top border (`worked-for-item-content-78a5b53d07f6.js`).

Expanded tool-activity lists use Codex's 224px cap and 24px scroll-driven top/bottom fade, leaving their summary outside the scroll area. Tool rows use 20px line height with 4px gaps and no horizontal inset. The approval split button uses the default unseparated style: no border between the primary action and dropdown.

## Output lifecycle and Markdown rendering

The 2026-10-25 output pass also reads `_MarkdownRoot_16avx_2`, `_InlineCode_16avx_2`
and `uC` / `Bw` from the installed initial CSS and activity bundle. Local chat
Markdown uses a quarter-body-font spacing unit, H1/H2/H3 scales 1.5/1.25/1.125,
upright quotes, and inline code at 0.92em. Inline code must not inherit the
independent fenced-code size. A successful final response has a 20px action row;
interrupted and failed replies do not reserve that row before their status.
Shell command clamping excludes vertical padding; the wrapper owns that padding.

Markdown uses the existing `marked` lexer with React rendering. Raw HTML and
unsafe URL schemes remain inert. Pathological single-line input stays plain
instead of blocking the renderer; fenced code highlighting has bounded input.
Remote HTTP(S) images are shown as explicit external-open links instead of loading
automatically, and the page CSP permits images only from the app, data, and blob URLs.
Workspace file references use the existing file pane and preserve line targets,
including special characters in project/file names; local images use the bounded
`/api/file` handler and Lightbox. Files outside the workspace are not granted access.
Collapsed tool details are unmounted after the close animation.

Compaction is a timeline item: running, delayed, manual/automatic completion,
interrupted or disconnected. API retry notices settle when output resumes.
An actual process exit settles pending tools; a transport loss records uncertainty
and does not claim the CLI stopped. Errors belong to their reply, with bridge-owned
failure metadata in `<session>.turn-results.jsonl` so history can restore them.
User interruption is excluded from failure metadata. CLI transcripts are not rewritten.


## Conversation rendering follow-through

Reference remains the locally installed Codex 26.1021.31345 packed implementation.
Noa adapts its display capabilities to stream-json: indexed text/thinking/tool blocks,
frame-batched deltas, completed-prefix Markdown reuse, local KaTeX/Mermaid, scoped
media range requests, file citations/review comments, selection quoting, rich copy,
and table/code previews. Remote subresources remain blocked; HTML previews use an
opaque sandbox with scripts disabled. Mermaid is loaded only for complete diagrams.

Completed successful turns fold commentary, tool activity, process images and checklist
snapshots into Worked for, including recovered tool failures. The final answer, workspace
diff and running background tasks remain visible. Noa waits for turn completion because
stream-json has no Codex final-answer phase marker. Interrupted/incomplete turns stay open.
Terminal and idle events settle pending reasoning/tools; historical checklist states do
not animate after the turn ends. Genuine running background tasks retain their animation.
The workspace diff card keeps its snapshot wording and Undo confirmation, with a persistent
View changes button, totals under the title and three initial file rows.

History still uses the CLI's canonical branch/compaction recovery, avoiding a second
raw-file copy. The renderer loads earlier turns in pages, expanding the page when a
background result needs an older call. GUI-only Hook/task lifecycle records live in
`<session>.gui-events.jsonl`, anchored to transcript UUIDs; they never change model
messages. Nested Agent transcripts use the existing session/subagents paths.

Verification: `bun test`, `bun run typecheck`, `bun run test:bridge`, and
`bun scripts/e2e-conversation.ts` from `gui/`. The Electron check uses synthetic data
and an isolated profile; its snapshots are component fixtures, not user conversations.


## Recovery and format boundary verification

Active indexed streams remain in the bridge journal until a completed model message
has canonical blocks. Disk task inference cannot replace completed/failed/stopped
lifecycle records. Paging protects background tool/task and Hook dependencies;
loading older pages reconciles Hook identity and retains earlier child output.
The bridge supplies user UUIDs to the existing SDK input field, so live messages
and disk history share bookmark identity. UUID-less legacy entries receive stable
session/record identities. Bookmarks use a v2 ID-based key; old ordinal keys remain
untouched because a page-local ordinal cannot be reliably mapped after paging.

Math follows the installed Codex delimiter rules: `\(...\)`, `\[...\]`,
paired runs of at least two dollars, and `math` fences. Single dollars remain text,
preserving shell variables. Display math takes precedence over setext headings.
Details/summary is parsed into structured Markdown, not executed as raw HTML;
code fences and indented code protect literal closing tags. File citation aliases,
Codex line/label coercion, and review ranges reach the file viewer's line highlights.
Lightbox uses a native modal dialog and offers local image downloads. Alt+Up/Down
navigates prompts, including from the composer; form/menu/modal and IME input retain
priority, and older pages are loaded when the previous prompt is not mounted.

`bun run test:rendering` serves component fixtures over loopback HTTP with the
production CSP and media handler. It asserts replay/task/Hook output, math, ranges,
details, UUID bookmarks, MCP/Todo/Hook DOM content, native Tab confinement,
`will-download` completion, and native Alt prompt navigation. These are component
fixtures, not a claim that their synthetic events exercised the full CLI. The
separate `test:bridge` suite exercises the real CLI and asserts live/disk user UUID
identity. `e2e-conversation.ts` also now asserts MCP/Todo/Hook rendering directly.

The rendering check accepts `gui-path output-path light|dark` arguments. It also
mounts the real App with isolated transport fixtures at 1440, 1100 and 960px, plus
960×600 with simultaneous approval, MCP input and a long composer draft. Assertions
cover theme colours, source-backed diff typography, code palettes, diagram themes,
panel-tab keyboard visibility, horizontal containment and footer/control bounds.
Code colours follow the installed Absolutely Light/Dark theme; the composer uses
Codex's `min(25dvh, var(--composer-editor-max-height, 25dvh))` editor limit. Pending
requests share a scrollable region and the footer stays within its content column.

Edit approvals follow the installed pending-request panel's `Yn` file summary and
its diff-preview tooltip: an inset filename/statistics row, an 800ms hover delay,
and a viewport-bounded preview that also opens from keyboard focus. Escape closes
the preview without deciding the approval. Noa previews replacement fragments,
so it does not present fragment line numbers or newline markers as file context.


Activity sidecars created before the first transcript use private directory/file
modes (0700/0600). Undo/Reapply emits an update-only turn diff: clients do not
attach it to a different loaded turn, and the server refreshes paged history.
Open conversation image viewers live above folded or virtualized message rows,
so turn completion does not dismiss them. Approval preview dismissal also cancels
its pending hover timer, including when the window resizes.
