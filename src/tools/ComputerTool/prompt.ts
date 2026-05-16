export const COMPUTER_TOOL_NAME = 'computer'

export const FULL_PROMPT = `Control the user's macOS desktop. Use a single \`action\` field to choose which operation to perform; other fields are action-specific.

## When to use
- The user asks you to interact with a GUI app on their machine (Messages, WeChat, Notes, Maps, Finder, Photos, System Settings, third-party apps).
- A workflow needs cross-app coordination (e.g. copy from one app, paste into another).
- A web task has no API and you must drive the browser visually.

## DEFAULT FIRST-ACTION SEQUENCE (read before any other action)

**Step 0 (before everything): can a single \`apple_script\` call complete this task?** If yes, do that and stop — do not open the app, do not screenshot, do not press keys. Tasks below are typically one apple_script call (see the "AppleScript one-liners" section); only fall through to the GUI sequence when the target app has no AppleScript dictionary (WeChat, most Electron apps).

Most remaining app tasks follow this exact pattern. **Do NOT default to screenshot+click.** Try this sequence first; only fall through to screenshot when a step has no shortcut equivalent.

1. **Enter the target app first.** Start with \`open_app <name-or-bundle-id>\` (or \`activate_app\` if already running) → \`wait 300\` → optionally \`frontmost_app\` if the app identity matters. Do not screenshot, click, type, or press shortcuts until the target app is frontmost. Only \`open_app\` / \`activate_app\` establish the target-app guard for later foreground actions; \`frontmost_app\` is verification only.
2. **Use the universal shortcut for the operation** — almost every app has these:
   - Search / find a contact, file, message: \`key cmd+f\`
   - New chat / document / tab: \`key cmd+n\`
   - Settings: \`key cmd+,\`
   - Confirm / Select / Open / Send: \`key return\`
   - Cancel / Close popover: \`key escape\`
3. **Insert text with restored clipboard** — use \`type\` with \`via_clipboard: true\`. ALWAYS for non-ASCII (中文/日本語/한국어) and for everything ≥ 20 chars. This pastes through the clipboard and restores the user's previous clipboard afterward.
4. **Confirm selection with \`key return\`.** After search/filter text is pasted, the result is usually only highlighted, not opened. Wait 200–500 ms, then press \`return\` to select/open the highlighted item. Use \`arrow-down\` / \`arrow-up\` first only when the first result is wrong.
5. **Only screenshot + click** when steps 1–4 cannot reach the next UI target (e.g., clicking into a chat input area that has no keyboard shortcut to focus).

Do not take screenshots merely to confirm successful simple keyboard workflows. If \`open_app\`, \`key\`, \`type\`, or \`wait\` succeeds in an app-guarded chat/contact workflow, continue with the next deterministic action or finish. Screenshot only when the user explicitly asks to see the screen, a prior action errored, the result is genuinely ambiguous before a risky send, or you need coordinates for an allowed coordinate action.

### App-first contract

- The target app is the source of truth. Always establish it with macOS app control (\`open_app\` or \`activate_app\`) before acting. Use \`frontmost_app\` only to verify focus, not to skip app activation.
- When the user says the result was wrong and asks you to retry, do the whole workflow again from the beginning: \`open_app\` / \`activate_app\`, wait, search/select the target item again, then perform the action. Do not assume the previous app, window, search result, conversation, or input focus is still valid.
- Never infer the active app from a screenshot alone. A visible window may not be frontmost, and clicks may hit the wrong app or a hidden overlay.
- Every foreground operation must be app-guarded. After the target app is established, the tool verifies focus automatically; still pass \`expected_app\` on \`key\`, \`type\`, \`click\`, \`scroll\`, and \`drag\` whenever you know the app. If the tool reports the frontmost app is wrong, re-open/reactivate the target app and restart the full flow.
- Coordinates are weak signals. They are acceptable only after the app is frontmost, a fresh screenshot exists, and keyboard/menu/clipboard routes cannot complete the step.
- Do not click search results, sidebar items, menu items, or list rows when a keyboard route exists. Use search/filter text, arrow keys if needed, then \`return\` to select.
- If coordinate recognition is uncertain, stop and re-screenshot or use menus/shortcuts. Do not chain multiple coordinate clicks based on one guess.

### Selection rule

In macOS apps, typing or pasting into search normally filters results; it does not always open/select the item. After any search, quick switcher, contact picker, file picker, command palette, sidebar filter, or list navigation:

1. \`wait 200\` to \`wait 500\`
2. If the desired item is not the first highlighted result, use \`key arrow-down\` or \`key arrow-up\`
3. Press \`key return\` to confirm/open/select

Do this before typing the next payload. For chat apps, selecting the conversation with \`return\` must happen before pasting the message.

For chat/contact workflows, treat contact selection and message sending as two separate phases:

1. Contact phase: search/paste the contact name, wait, press \`return\` to open the conversation.
2. Conversation phase: only after the conversation is open should you paste the message body and press \`return\` to send.

Never paste the message body while the search box, contact picker, or result list is still active.

### Worked example — send a message in a chat/IM app

User: "open WeChat and send 'hi' to John"
- \`open_app "WeChat"\` → \`wait 500\`
- \`key { keys: "cmd+f", expected_app: "WeChat" }\` (opens search)
- \`type { text: "John", via_clipboard: true, expected_app: "WeChat" }\` → \`wait 300\` → \`key { keys: "return", expected_app: "WeChat" }\` (confirms the highlighted result and opens the chat)
- \`wait 300\`
- \`type { text: "hi", via_clipboard: true, expected_app: "WeChat" }\` → \`key { keys: "return", expected_app: "WeChat" }\` (sends)

Total: usually 7 tool calls, zero screenshots. Do not add screenshots by default when each step succeeds. If the search result is ambiguous, the contact is not obviously selected, focus may still be in the search box, or a step errors, take at most one screenshot to diagnose before pasting the message body.

This pattern (open → cmd+f → paste contact → wait → return to open conversation → paste message → return to send) works for WeChat, Slack, Telegram, Messages, Discord, Linear, Notion, and most search-driven apps.

## Available actions

- **\`screenshot\`** — capture the current screen. **Use sparingly.** Use it when (a) the user explicitly asks to see/capture the screen, (b) you need pixel coordinates for a forthcoming allowed Tier 6 click/scroll/drag, (c) a prior action errored and visual inspection is the way to diagnose it, or (d) a search/contact result is genuinely ambiguous and sending text without checking could target the wrong conversation. Do not screenshot every successful keyboard step, and do not screenshot merely to confirm that a simple app-guarded keyboard action succeeded. Returns an image.
  - Optional: \`display\` (1-indexed integer; default = primary).

- **\`click\`** — last-resort click at screenshot image coordinates. Do not use this for selecting search results, list rows, sidebars, menu items, or buttons that can be reached by Return, arrows, shortcuts, menus, or AppleScript. For chat/contact apps (WeChat, Messages, Slack, Telegram, Discord, WhatsApp, Signal, LINE, Teams, Lark/Feishu, DingTalk), \`click\` is not an acceptable way to find/select contacts or conversations and may be rejected; use cmd+f/cmd+k, clipboard paste, arrow keys, and Return. Use the pixel position from the latest \`screenshot\` result; the tool converts it to macOS screen coordinates.
  - Required: \`x\`, \`y\`
  - Optional: \`button\` ('left' | 'right', default 'left'), \`count\` (1|2|3, default 1), \`modifiers\` (array like ['cmd','shift'])

- **\`type\`** — type literal text. Handles multi-line.
  - Required: \`text\`
  - Optional: \`via_clipboard\` (boolean, default false) — paste via cmd+v; necessary for emoji or non-ASCII without an active IME.

- **\`key\`** — press a key combo or named key. Examples: 'cmd+a', 'cmd+shift+t', 'return', 'escape', 'arrow-down', 'f5'.
  - Required: \`keys\`
  - Optional: \`repeat\` (default 1)

- **\`scroll\`** — scroll at a screenshot image coordinate.
  - Required: \`x\`, \`y\`, \`direction\` ('up' | 'down'), \`amount\` (number of lines, 1-50)

- **\`drag\`** — drag the mouse from start to end using screenshot image coordinates (10-step interpolation).
  - Required: \`to_x\`, \`to_y\`
  - Optional: \`from_x\`, \`from_y\` (defaults to current cursor)

- **\`cursor_position\`** — return the current cursor (x, y).

- **\`open_app\`** — launch or focus an application.
  - Required: \`name\` (bundle id like 'com.apple.Notes' or app name like 'Notes' or 'WeChat'; common localized aliases such as \`微信\`, \`WeChat\`, and \`Weixin\` resolve to the same app identity when installed)

- **\`activate_app\`** — bring an already-running app to the front.
  - Required: \`name\` (same aliases and bundle ids as \`open_app\`)

- **\`frontmost_app\`** — return the currently focused app's name and bundle id.

- **\`read_clipboard\`** — return current clipboard text.

- **\`write_clipboard\`** — set clipboard text and leave it there. Required: \`text\`. Do not use this as the normal paste path for app input; prefer \`type\` with \`via_clipboard: true\`, which restores the user's previous clipboard.

- **\`apple_script\`** — run an AppleScript via \`osascript\`. This is the **preferred** path for any task an app exposes through its AppleScript dictionary (Calendar, Mail, Notes, Reminders, Music, Finder, Contacts, Safari, Pages/Numbers/Keynote) and for read-only System Events probes such as menu-tree inspection. Do not use arbitrary System Events keystrokes or clicks for foreground app mutations; use \`open_app\` / \`activate_app\` plus \`key\` or \`menu_click\` so app guards and search-selection state apply. Returns stdout text.
  - Required: \`script\`
  - Probe first if unsure: \`tell application "X" to get version\` (no error = scriptable). For UI scripting: \`tell application "System Events" to tell process "X" to name of every menu item of every menu of menu bar 1\`.

- **\`menu_click\`** — click a named menu item via System Events. Path is the full menu chain from the menu bar to the target item. Works even on apps without AppleScript dictionaries (WeChat, Slack, Discord, VSCode).
  - Required: \`app\` (process name as it appears in Activity Monitor — e.g. "WeChat", "NeteaseMusic"), \`path\` (string array, ≥ 2 items: menu bar item + at least one menu item; submenus go in the middle, e.g. \`["Edit", "Find", "Find…"]\` or \`["Controls", "Pause"]\`).

- **\`wait\`** — sleep. Required: \`ms\` (50-5000).

### Optional guard field (every mutating action)

- **\`expected_app\`** — declare which app you intend to act on (exact display name, known alias, or exact bundle id). When set on \`click\` / \`type\` / \`key\` / \`scroll\` / \`drag\` / \`menu_click\` / \`write_clipboard\`, the tool checks the frontmost app immediately before executing and refuses with errorCode 5 if it doesn't match. Foreground actions also require a target app established by the last \`open_app\` or \`activate_app\`; \`frontmost_app\` and \`expected_app\` alone cannot establish that target, so retries must restart from app activation.

## macOS control strategy (try tiers top-down — each is faster and more robust than the next)

1. **macOS app control** — \`open_app\`, \`activate_app\`, then \`wait\`. This is mandatory for app tasks.
2. **AppleScript dictionary** — \`apple_script\` action with \`tell application "X" to <verb>\`. Probe with \`...to get version\` (no error = scriptable). Works for Calendar, Mail, Music, Notes, Finder, Contacts, Reminders, Safari, Terminal, Pages/Numbers/Keynote. Prefer this over the \`Bash\` tool — it's the same osascript binding but already serialized and timed correctly.
3. **UI scripting (menu)** — \`menu_click\` action with \`{ app, path }\`. Works on any app with standard menus, including Electron apps (WeChat, Slack, VSCode, Discord) where Tier 2 fails. Probe the menu tree first with \`apple_script\`: \`tell application "System Events" to tell process "X" to name of every menu item of every menu of menu bar 1\`.
4. **Keyboard shortcuts** — the \`key\` action with cmd+f / cmd+, / cmd+w / arrows / return. Universal and version-stable. Use \`return\` to confirm highlighted search results and selected rows.
5. **Clipboard-backed text input** — \`type\` with \`via_clipboard: true\`. **Required** for non-ASCII (中文/日本語/한국어) and for text > 50 chars. Plain \`type\` with non-ASCII drops or corrupts characters; never use plain typing for that.
6. **Screenshot + pixel click** — fallback only. Use when Tiers 1–5 all fail (canvas apps, games, custom-drawn UI without accessibility labels). **Each click/scroll/drag invalidates the cached screenshot context**: you must take a new screenshot before the next coordinate action, otherwise the tool returns errorCode 3. This is intentional — chaining clicks against a stale image is the #1 source of wrong-target clicks.

## Cross-app rules

- After \`open_app\` or \`activate_app\`, \`wait\` 200 ms before the next action — the window may not be ready.
- If a prior attempt did not achieve the user request and the user asks you to retry, restart from \`open_app\` / \`activate_app\`; never skip directly to typing, pressing Return, or clicking based on the previous partial state.
- After typing or pasting search/filter text, \`wait\` 200–500 ms and press \`return\` to confirm the highlighted result before continuing.
- Menu item names are stable across app versions; pixel coordinates are not. Prefer menus.
- For unfamiliar apps, probe first (Tier 2 version check, Tier 3 menu dump) before clicking blind.
- Do not perform a click as the first action in an app workflow. Open or activate the intended app first.

## AppleScript one-liners (Tier 2 — prefer these over any GUI sequence)

For these apps and tasks, a single \`apple_script\` call replaces the entire open → activate → cmd+f → paste → return → paste → return ladder. **Use them.** Do not screenshot, do not open the app first, do not press keys.

- **Send iMessage** (Messages.app):
  \`apple_script { script: 'tell application "Messages" to send "<message>" to buddy "<phone or email>" of (1st service whose service type = iMessage)' }\`
  If that service type errors (user has no iMessage configured), retry with \`service type = SMS\` for the carrier service. The recipient identifier must be a phone number (with country code) or an email registered to iMessage.
- **Create a Calendar event** (uses relative dates — locale-safe):
  \`apple_script { script: 'tell application "Calendar" to tell calendar "<calendar name>" to make new event with properties {summary:"<title>", start date:(current date) + 3600, end date:(current date) + 7200}' }\`
- **List today's events**:
  \`apple_script { script: 'tell application "Calendar" to get summary of (every event of calendar "<name>" whose start date ≥ (current date) and start date < (current date) + 86400)' }\`
- **Create a Reminder** (use \`(current date) + N\` seconds — never \`date "MM/DD/YYYY ..."\`, that string is locale-dependent and breaks on non-US systems):
  \`apple_script { script: 'tell application "Reminders" to make new reminder with properties {name:"<text>", due date:(current date) + 3600}' }\`
- **Create a Note**:
  \`apple_script { script: 'tell application "Notes" to make new note with properties {name:"<title>", body:"<html or text>"}' }\`
- **Send Mail**: not a one-liner — Mail needs a multi-statement \`tell\` block (\`tell ... to <stmt>\` only takes a single statement). Send the script as a multi-line string with real newlines (NOT the two characters \`\\n\`):

  \`\`\`
  tell application "Mail"
    set m to make new outgoing message with properties {subject:"<s>", content:"<body>", visible:false}
    tell m to make new to recipient with properties {address:"<addr>"}
    send m
  end tell
  \`\`\`
  Pass this whole block as the \`script\` field of one \`apple_script\` call.
- **Play/pause Music.app**:
  \`apple_script { script: 'tell application "Music" to playpause' }\`
- **Open a Finder location**:
  \`apple_script { script: 'tell application "Finder" to open (POSIX file "<POSIX path>")' }\`
- **Open a URL in the default browser** (do NOT open the browser then type into the address bar):
  \`apple_script { script: 'open location "<url>"' }\`
  For a specific browser: \`apple_script { script: 'tell application "Safari" to open location "<url>"' }\` or \`tell application "Google Chrome" to open location "<url>"\`.
- **Get Safari front tab URL**:
  \`apple_script { script: 'tell application "Safari" to URL of front document' }\`
- **Show a system notification** (any user-visible toast):
  \`apple_script { script: 'display notification "<body>" with title "<title>"' }\`

If you're unsure whether an app is scriptable, probe with \`apple_script { script: 'tell application "<name>" to get version' }\` — non-error = scriptable. Then check its dictionary terminology by asking the user or recalling standard verbs (make/get/set/send/play/open).

## Known app playbooks

Use these app-specific flows before falling back to screenshots.

### NetEase Cloud Music / NeteaseMusic

Direct AppleScript playback commands do not work reliably in NeteaseMusic. Do not use \`tell application "NeteaseMusic" to pause\`, \`playerState\`, spacebar, or media key simulation for play/pause.

Use app-first \`menu_click\`:
1. \`open_app "NeteaseMusic"\` → \`wait 300\`
2. Pause: \`menu_click { app: "NeteaseMusic", path: ["Controls", "Pause"], expected_app: "NeteaseMusic" }\`
3. Play: \`menu_click { app: "NeteaseMusic", path: ["Controls", "Play"], expected_app: "NeteaseMusic" }\`

### WeChat

For contact search and sending messages, prefer keyboard shortcuts and clipboard paste:
1. \`open_app "WeChat"\` → \`wait 500\`
2. \`key { keys: "cmd+f", expected_app: "WeChat" }\`
3. \`type { text: <contact name>, via_clipboard: true, expected_app: "WeChat" }\`
4. \`wait 300\` → \`key { keys: "return", expected_app: "WeChat" }\` to confirm the highlighted contact/search result and enter the conversation. This step is mandatory.
5. \`wait 300\`. If the contact name was unambiguous and Return succeeded, continue without a screenshot. If the result was ambiguous or focus may still be in search, screenshot once before pasting the message body.
6. \`type { text: <message>, via_clipboard: true, expected_app: "WeChat" }\` → \`key { keys: "return", expected_app: "WeChat" }\`

Never paste the message at step 3 or 4. The first text insertion is the contact name; the second text insertion is the message body after the conversation has opened. Pass \`expected_app: "WeChat"\` on the message-body \`type\` and final \`key return\` to refuse the send if focus has drifted to another app.

Do not click contacts, conversations, search results, or list rows in WeChat. The computer tool can reject clicks in chat/contact apps; if you need to retry, restart the whole keyboard flow from \`open_app "WeChat"\` instead of clicking the visible result.

Always use clipboard paste for Chinese text in WeChat. Direct typing or AppleScript \`keystroke\` may corrupt non-ASCII input.

### Calendar

Calendar supports AppleScript data access. Use \`apple_script\` (NOT GUI control).

- List calendars: \`apple_script { script: 'tell application "Calendar" to name of calendars' }\`
- Query events from a known calendar over a date window: use AppleScript to select \`calendar "<name>"\`, compute \`nowDate\` and \`endDate\`, then return each event's \`summary\`, \`start date\`, and \`description\`.

## Operating principles

1. **AppleScript before GUI, every time.** If \`apple_script\` can do the task in one call (see "AppleScript one-liners"), use it and stop. Messages, Calendar, Reminders, Notes, Mail, Music, Finder, Safari, Contacts, Pages/Numbers/Keynote are all scriptable — driving them with open_app + cmd+f + clipboard paste is 7× the latency and strictly worse. Reserve the GUI sequence for apps without AppleScript dictionaries (WeChat and most Electron chat apps). Specifically: **never** open a browser then \`type\` a URL into the address bar — use \`open location "<url>"\` (one call, no app activation needed).
2. **Default app, unless the user names one.** Plain \`open location "<url>"\` already routes to the system default browser — keep it that way. Don't reroute to Safari/Chrome (or substitute a different mail/calendar/file/PDF app) unless the user explicitly named the app.
3. **Native app before web for service brands.** When the request names a product that has both a native app and a web version (ChatGPT, Slack, Notion, Linear, Discord, Spotify, etc.), attempt \`open_app "<Name>"\` first — it succeeds if installed (launching/focusing the app) and errors if not. On error, fall through to \`open location "https://..."\`. If you need to check installation *without* launching, use \`apple_script { script: 'id of application "<Name>"' }\` instead — and do NOT use \`tell application "<Name>" to get version\` as the install probe, since it errors on Electron apps (ChatGPT/Slack/Notion/etc.) even when installed.
4. **App first, then action.** When you do fall through to the GUI path: re-read the DEFAULT FIRST-ACTION SEQUENCE above. Enter the intended app with macOS app control before using shortcuts, text input, screenshots, or clicks.
5. **Retry means restart.** If a previous GUI attempt was wrong or incomplete, do not continue from wherever the UI appears to be. Re-establish the target app and repeat the complete workflow.
6. **Return confirms selection.** After search/filter/list navigation, press \`return\` before assuming the item is open or selected.
7. **Do not screenshot every keyboard step.** Sending a WeChat/Slack/Discord message should usually be 6-8 tool calls with **zero** screenshots — open → cmd+f → paste contact → return → paste message → return. Use a screenshot only when the result/contact is ambiguous before a risky send, focus is uncertain after an actual error, or the user explicitly requested a screenshot.
8. **Verify coordinate-driven actions only.** After a Tier 6 click/scroll/drag, screenshot to confirm before chaining another coordinate action because the screenshot context was just invalidated and the UI may have changed. Do not apply this verification rule to successful keyboard, clipboard, app-open, or wait actions.
9. **Coordinates are in screenshot image space.** Use the dimensions reported with each screenshot (e.g., \`1568×980\`). The tool automatically converts to the real macOS screen — do NOT scale them yourself. If you haven't screenshotted yet, screenshot first.
10. **For web pages, prefer a real HTTP/MCP route if available.** The browser is reachable, but typing into web fields is fragile.
11. **Don't execute financial trades, money transfers, or destructive system actions.** Ask the user to do those themselves.
12. **The user can press Ctrl+C in the terminal at any time to abort.** If you suspect a step is wrong, stop and screenshot rather than barreling forward.`
