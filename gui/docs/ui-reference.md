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

## Verification

From `gui/`: `bun run typecheck`, `bun run build`, `bun run scripts/e2e-workspace.ts`.
The workspace E2E starts real HTTP bridges against temporary Git repositories.
It covers workspace boundaries, file saves, Git mutations, session metadata and
transcript restoration. Browser-level layout, menu, draft, file-reference and
agent-approval checks are not automated yet.

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

The right column is one pane under a tab strip (Files, Changes, Context, Activity) with a
close control, replacing the stacked cards, per-card minimise/expand, move handles and the
titlebar checklist. Tabs follow the WAI-ARIA tablist pattern (`role="tab"`, `aria-selected`,
arrow-key navigation), as Codex's `TabsList` / `TabsTrigger` do. The titlebar toggle shows or
hides the column. Not ported from Codex: tab drag-to-move, detached windows, tab thumbnails.

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
