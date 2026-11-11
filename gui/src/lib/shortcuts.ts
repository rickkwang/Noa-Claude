// Customizable global shortcuts. A binding is "+"-joined modifiers then a KeyboardEvent.code, e.g. "mod+KeyN".
// "mod" is Command on macOS and Ctrl elsewhere; "ctrl" is always the Control key. An empty string means unbound.

export const SHORTCUT_IDS = ['newTask', 'findTasks', 'settings', 'bottomPanel', 'terminal'] as const
export type ShortcutId = (typeof SHORTCUT_IDS)[number]
export type ShortcutBindings = Record<ShortcutId, string>

export const SHORTCUT_LABELS: Record<ShortcutId, string> = {
  newTask: 'New task',
  findTasks: 'Find tasks',
  settings: 'Settings',
  bottomPanel: 'Toggle bottom panel',
  terminal: 'Open terminal',
}

export const defaultShortcuts: ShortcutBindings = {
  newTask: 'mod+KeyN',
  findTasks: 'mod+KeyK',
  settings: 'mod+Comma',
  bottomPanel: 'mod+KeyJ',
  terminal: 'ctrl+Backquote',
}

const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac')

// Off macOS, "mod" and "ctrl" are the same key; normalizing lets conflict checks compare them correctly.
export function normalizeBinding(binding: string): string {
  if (isMac) return binding
  return binding.split('+').map((part) => (part === 'mod' ? 'ctrl' : part)).join('+')
}

export function matchesShortcut(event: KeyboardEvent, binding: string): boolean {
  if (!binding) return false
  const parts = binding.split('+')
  const code = parts.pop()
  if (event.code !== code) return false
  const mods = new Set(parts)
  const primary = mods.has('mod')
  return (
    event.metaKey === (primary && isMac) &&
    event.ctrlKey === (mods.has('ctrl') || (primary && !isMac)) &&
    event.altKey === mods.has('alt') &&
    event.shiftKey === mods.has('shift')
  )
}

// Returns null for a bare modifier press or a key with no modifier, so the recorder keeps waiting.
export function bindingFromEvent(event: KeyboardEvent): string | null {
  if (/^(Meta|Control|Alt|Shift)(Left|Right)?$/.test(event.code) || !event.code) return null
  const mods: string[] = []
  if (isMac ? event.metaKey : event.ctrlKey) mods.push('mod')
  if (isMac && event.ctrlKey) mods.push('ctrl')
  if (!isMac && event.metaKey) return null
  // Shift alone only types a capital letter, so a binding needs Command, Ctrl or Alt.
  if (event.altKey) mods.push('alt')
  if (mods.length === 0) return null
  if (event.shiftKey) mods.push('shift')
  return [...mods, event.code].join('+')
}

export function formatBinding(binding: string): string[] {
  if (!binding) return []
  const parts = binding.split('+')
  const code = parts.pop() ?? ''
  const keys = parts.map((part) => {
    if (part === 'mod') return isMac ? '⌘' : 'Ctrl'
    if (part === 'ctrl') return isMac ? '⌃' : 'Ctrl'
    if (part === 'alt') return isMac ? '⌥' : 'Alt'
    return isMac ? '⇧' : 'Shift'
  })
  const label = code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : (({ Comma: ',', Backquote: '`' } as Record<string, string>)[code] ?? code)
  return [...keys, label]
}

// Compact label for menus and hints: "⌘N" on macOS, "Ctrl N" elsewhere; empty when unbound.
export function shortcutHint(binding: string): string {
  return formatBinding(binding).join(isMac ? '' : ' ')
}

export function findShortcutConflict(bindings: ShortcutBindings, id: ShortcutId, binding: string): ShortcutId | null {
  const target = normalizeBinding(binding)
  if (!target) return null
  return SHORTCUT_IDS.find((other) => other !== id && bindings[other] && normalizeBinding(bindings[other]) === target) ?? null
}
