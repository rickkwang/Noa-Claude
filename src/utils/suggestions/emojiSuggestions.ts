// @ts-nocheck
import type { SuggestionItem } from '../../components/PromptInput/PromptInputFooterSuggestions.js'

/**
 * `:shortcode` emoji autocomplete for the prompt input.
 *
 * A curated table of common shortcodes → emoji (GitHub/Slack-style names). This
 * is intentionally a compact, high-signal set rather than the full emojilib
 * dump — it covers the emoji people actually reach for in commit-message and
 * chat-style prompts without shipping ~1800 entries into the bundle. Extend the
 * table below as needed.
 */
export const EMOJI_SHORTCODES: Readonly<Record<string, string>> = {
  // faces — positive
  smile: '😄',
  smiley: '😃',
  grin: '😁',
  laughing: '😆',
  joy: '😂',
  rofl: '🤣',
  slightly_smiling_face: '🙂',
  wink: '😉',
  blush: '😊',
  innocent: '😇',
  heart_eyes: '😍',
  star_struck: '🤩',
  kissing_heart: '😘',
  yum: '😋',
  sunglasses: '😎',
  smirk: '😏',
  relieved: '😌',
  // faces — thinking / neutral
  thinking: '🤔',
  neutral_face: '😐',
  expressionless: '😑',
  no_mouth: '😶',
  rolling_eyes: '🙄',
  grimacing: '😬',
  zipper_mouth_face: '🤐',
  shushing_face: '🤫',
  raised_eyebrow: '🤨',
  // faces — negative
  confused: '😕',
  worried: '😟',
  frowning: '🙁',
  cry: '😢',
  sob: '😭',
  disappointed: '😞',
  pensive: '😔',
  weary: '😩',
  tired_face: '😫',
  fearful: '😨',
  cold_sweat: '😰',
  scream: '😱',
  confounded: '😖',
  persevere: '😣',
  rage: '😡',
  angry: '😠',
  // faces — misc
  sleeping: '😴',
  sleepy: '😪',
  zzz: '💤',
  dizzy_face: '😵',
  exploding_head: '🤯',
  nauseated_face: '🤢',
  sneezing_face: '🤧',
  mask: '😷',
  sweat_smile: '😅',
  upside_down_face: '🙃',
  money_mouth_face: '🤑',
  nerd_face: '🤓',
  partying_face: '🥳',
  pleading_face: '🥺',
  // hands / gestures
  '+1': '👍',
  thumbsup: '👍',
  '-1': '👎',
  thumbsdown: '👎',
  ok_hand: '👌',
  wave: '👋',
  raised_hands: '🙌',
  clap: '👏',
  pray: '🙏',
  muscle: '💪',
  point_up: '☝️',
  point_right: '👉',
  point_left: '👈',
  point_down: '👇',
  fist: '✊',
  facepunch: '👊',
  v: '✌️',
  crossed_fingers: '🤞',
  metal: '🤘',
  handshake: '🤝',
  writing_hand: '✍️',
  // hearts / symbols
  heart: '❤️',
  orange_heart: '🧡',
  yellow_heart: '💛',
  green_heart: '💚',
  blue_heart: '💙',
  purple_heart: '💜',
  black_heart: '🖤',
  broken_heart: '💔',
  sparkling_heart: '💖',
  heartbeat: '💓',
  // celebration / status
  fire: '🔥',
  sparkles: '✨',
  star: '⭐',
  star2: '🌟',
  boom: '💥',
  tada: '🎉',
  confetti_ball: '🎊',
  balloon: '🎈',
  gift: '🎁',
  trophy: '🏆',
  medal: '🏅',
  crown: '👑',
  rocket: '🚀',
  zap: '⚡',
  bulb: '💡',
  100: '💯',
  check: '✔️',
  white_check_mark: '✅',
  heavy_check_mark: '✔️',
  x: '❌',
  warning: '⚠️',
  no_entry: '⛔',
  question: '❓',
  exclamation: '❗',
  // dev / work
  bug: '🐛',
  wrench: '🔧',
  hammer: '🔨',
  gear: '⚙️',
  lock: '🔒',
  unlock: '🔓',
  key: '🔑',
  computer: '💻',
  keyboard: '⌨️',
  package: '📦',
  memo: '📝',
  pencil: '✏️',
  clipboard: '📋',
  chart_with_upwards_trend: '📈',
  chart_with_downwards_trend: '📉',
  hourglass: '⌛',
  alarm_clock: '⏰',
  calendar: '📅',
  pushpin: '📌',
  paperclip: '📎',
  mag: '🔍',
  link: '🔗',
  recycle: '♻️',
  construction: '🚧',
  skull: '💀',
  ghost: '👻',
  robot: '🤖',
  eyes: '👀',
  brain: '🧠',
  // nature / food (common)
  sun: '☀️',
  cloud: '☁️',
  rainbow: '🌈',
  snowflake: '❄️',
  ocean: '🌊',
  earth_americas: '🌎',
  seedling: '🌱',
  four_leaf_clover: '🍀',
  cat: '🐱',
  dog: '🐶',
  unicorn: '🦄',
  coffee: '☕',
  beer: '🍺',
  pizza: '🍕',
  hamburger: '🍔',
  cake: '🍰',
  birthday: '🎂',
  apple: '🍎',
  poop: '💩',
}

const EMOJI_NAMES: readonly string[] = Object.keys(EMOJI_SHORTCODES)

// Matches Claude Code 2.1.217's cap of 20 candidates in the popup.
const MAX_EMOJI_SUGGESTIONS = 20

/**
 * Popup trigger. Matches a partial `:query` (no closing colon) at the cursor,
 * anchored to a word boundary (start of input or after whitespace) so it never
 * fires inside `http://`, `12:30`, or an `@server:resource` token. Requires two
 * query chars to avoid spamming on a lone `:`. `m[1]` is the boundary, `m[2]`
 * the query. Byte-identical to the upstream `Rqa` regex.
 */
export const EMOJI_TRIGGER_RE = /(^|\s):([a-z0-9_+-]{2,})$/

/**
 * Inline-replacement trigger. Matches a *complete* `:name:` (both colons) at the
 * cursor. Upstream's `KtS` regex — used to auto-swap a fully typed shortcode for
 * its glyph without touching the popup.
 */
export const EMOJI_INLINE_RE = /(^|\s):([a-z0-9_+-]+):$/

/** Exact shortcode → glyph lookup (upstream `getEmoji`). */
export function getEmoji(name: string): string | undefined {
  return EMOJI_SHORTCODES[name]
}

/**
 * Return emoji suggestions for a shortcode query. Prefix matches rank above
 * substring matches; ties break by shorter name (upstream sort: `i-s ||
 * a.length-b.length`, no alphabetical tiebreak — stable sort preserves table
 * order for full ties). Row layout mirrors upstream: `displayText` is the glyph
 * (name column), `description` is `:shortcode:`. The glyph to insert is also
 * kept in `metadata.emoji` for the apply path.
 */
export function getEmojiSuggestions(query: string): SuggestionItem[] {
  const q = query.toLowerCase()
  if (q.length === 0) return []

  const matches = EMOJI_NAMES.filter(name => name.includes(q))

  matches.sort((a, b) => {
    const aPrefix = a.startsWith(q) ? 0 : 1
    const bPrefix = b.startsWith(q) ? 0 : 1
    return aPrefix - bPrefix || a.length - b.length
  })

  return matches.slice(0, MAX_EMOJI_SUGGESTIONS).map(name => {
    const emoji = EMOJI_SHORTCODES[name]
    return {
      // noa's id convention is `<type>-<key>` (file-, agent-, dm-…); upstream
      // uses `emoji:${n}`. Kept as `emoji-` for local consistency.
      id: `emoji-${name}`,
      displayText: emoji,
      description: `:${name}:`,
      metadata: { emoji },
    }
  })
}

/**
 * Auto-replace a just-completed `:name:` shortcode with its glyph, reproducing
 * upstream's inline path (the `YtS` guard + `KtS` match + `getEmoji`).
 *
 * The guard fires *only* when the current edit was an insertion ending in `:`
 * (not a deletion, not cursor movement, not a mid-string edit): given the
 * previous input, the change must be a contiguous insert ending at the cursor
 * whose inserted chunk is `[a-z0-9_+-]*:`. This is what makes it convert exactly
 * once — when you type the closing colon — and never surprise you otherwise.
 *
 * Returns the replacement `{ newInput, newCursor }` (cursor sits right after the
 * glyph, no trailing space) or null when nothing should change.
 */
export function resolveInlineEmojiReplacement(
  input: string,
  prevInput: string | undefined,
  cursorOffset: number,
): { newInput: string; newCursor: number } | null {
  if (prevInput === undefined) return null
  const added = input.length - prevInput.length
  const insertStart = cursorOffset - added
  if (
    !(
      added > 0 &&
      insertStart >= 0 &&
      input.slice(0, insertStart) + input.slice(cursorOffset) === prevInput &&
      /^[a-z0-9_+-]*:$/.test(input.slice(insertStart, cursorOffset))
    )
  ) {
    return null
  }

  const beforeCursor = input.slice(0, cursorOffset)
  const m = beforeCursor.match(EMOJI_INLINE_RE)
  if (!m || m.index === undefined) return null
  const emoji = getEmoji(m[2])
  if (!emoji) return null

  const prefixStart = m.index + (m[1]?.length ?? 0)
  const newInput = input.slice(0, prefixStart) + emoji + input.slice(cursorOffset)
  return { newInput, newCursor: prefixStart + emoji.length }
}

/**
 * Replace the `:query` at the cursor with the selected emoji character. Mirrors
 * applyTriggerSuggestion but inserts the glyph from `metadata.emoji` (not the
 * `:shortcode:` label) and leaves the cursor immediately after it — no trailing
 * space, so the user controls spacing.
 */
export function applyEmojiSuggestion(
  suggestion: SuggestionItem,
  input: string,
  cursorOffset: number,
  onInputChange: (value: string) => void,
  setCursorOffset: (offset: number) => void,
): void {
  const emoji = (suggestion.metadata as { emoji?: string } | undefined)?.emoji
  if (!emoji) return
  const m = input.slice(0, cursorOffset).match(EMOJI_TRIGGER_RE)
  if (!m || m.index === undefined) return
  const prefixStart = m.index + (m[1]?.length ?? 0)
  const before = input.slice(0, prefixStart)
  const newInput = before + emoji + input.slice(cursorOffset)
  onInputChange(newInput)
  setCursorOffset(before.length + emoji.length)
}
