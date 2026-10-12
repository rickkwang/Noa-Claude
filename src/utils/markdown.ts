// @ts-nocheck
import chalk from 'chalk'
import { marked, type Token, type Tokens } from 'marked'
import stripAnsi from 'strip-ansi'
import { color } from '../components/design-system/color.js'
import { BLOCKQUOTE_BAR } from '../constants/figures.js'
import { stringWidth } from '../ink/stringWidth.js'
import { supportsHyperlinks } from '../ink/supports-hyperlinks.js'
import type { CliHighlight } from './cliHighlight.js'
import { logForDebugging } from './debug.js'
import { createHyperlink } from './hyperlink.js'
import { isEnvTruthy } from './envUtils.js'
import { stripPromptXMLTags } from './messages.js'
import type { ThemeName } from './theme.js'

// Use \n unconditionally — os.EOL is \r\n on Windows, and the extra \r
// breaks the character-to-segment mapping in applyStylesToWrappedText,
// causing styled text to shift right.
const EOL = '\n'

let markedConfigured = false

export function configureMarked(): void {
  if (markedConfigured) return
  markedConfigured = true

  // Only ~~double~~ tildes strike through. A lone ~ stays literal because the
  // model often uses it for "approximate" (e.g., ~100).
  marked.use({
    tokenizer: {
      del(src) {
        const match =
          /^~~(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))~~(?=[^~]|$)/.exec(src)
        if (!match) return undefined
        return {
          type: 'del',
          raw: match[0],
          text: match[1],
          tokens: this.lexer.inlineTokens(match[1]),
        }
      },
    },
  })
}

export function applyMarkdown(
  content: string,
  theme: ThemeName,
  highlight: CliHighlight | null = null,
): string {
  configureMarked()
  return marked
    .lexer(stripPromptXMLTags(content))
    .map(_ => formatToken(_, theme, 0, null, null, highlight))
    .join('')
    .trim()
}

// Characters that can hide or spoof text in a terminal: C0/C1 controls, bidi and
// zero-width format marks, and the ⧉ marker reserved for link warnings.
function sanitizeDisplay(text: string): string {
  return text.replace(
    /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u29c9\ufeff]/g,
    '',
  )
}

// A link is shown as clickable text only when its URL is a plain address.
// Local paths, file: URLs, and URLs with control characters stay visible as text.
function isWebDisplayableUrl(url: string): boolean {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(url) || url !== url.trimEnd()) {
    return false
  }
  return !/^(file:|\/|~|\.\.?\/)/i.test(url)
}

// Terminals known to render ANSI strikethrough. Mirrors upstream's allowlist so
// that terminals which draw it badly (Apple Terminal, linux console) get ~~x~~.
const STRIKETHROUGH_TERM_PROGRAMS = new Set([
  'iTerm.app',
  'vscode',
  'WezTerm',
  'WarpTerminal',
  'Hyper',
  'Tabby',
  'rio',
  'contour',
  'alacritty',
])

function supportsStrikethrough(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isEnvTruthy(env.NOA_CLAUDE_FORCE_STRIKETHROUGH ?? env.CLAUDE_CODE_FORCE_STRIKETHROUGH)) {
    return true
  }
  const term = env.TERM
  const termProgram = env.TERM_PROGRAM
  if (termProgram === 'Apple_Terminal' || term === 'linux') return false
  return (
    STRIKETHROUGH_TERM_PROGRAMS.has(termProgram ?? '') ||
    termProgram === 'ghostty' ||
    term === 'xterm-ghostty' ||
    termProgram === 'mintty' ||
    (process.platform === 'win32' && !!env.MSYSTEM) ||
    env.TERMINAL_EMULATOR === 'JetBrains-JediTerm' ||
    env.LC_TERMINAL === 'iTerm2' ||
    !!term?.includes('kitty') ||
    !!term?.includes('alacritty') ||
    !!term?.startsWith('foot') ||
    !!env.KITTY_WINDOW_ID ||
    !!env.ALACRITTY_LOG ||
    !!env.KONSOLE_VERSION ||
    !!env.WT_SESSION ||
    !!env.ZED_TERM ||
    parseInt(env.VTE_VERSION ?? '', 10) >= 4400
  )
}

const NBSP_ENTITY_RE = /&(?:nbsp|#0{0,4}160|#[xX]0{0,4}[aA]0);/g

export function formatToken(
  token: Token,
  theme: ThemeName,
  listDepth = 0,
  orderedListNumber: number | null = null,
  parent: Token | null = null,
  highlight: CliHighlight | null = null,
): string {
  switch (token.type) {
    case 'blockquote': {
      const inner = (token.tokens ?? [])
        .map(_ => formatToken(_, theme, 0, null, null, highlight))
        .join('')
      // Prefix each line with a dim vertical bar. Keep text italic but at
      // normal brightness — chalk.dim is nearly invisible on dark themes.
      const bar = chalk.dim(BLOCKQUOTE_BAR)
      return inner
        .split(EOL)
        .map(line =>
          stripAnsi(line).trim() ? `${bar} ${chalk.italic(line)}` : line,
        )
        .join(EOL)
    }
    case 'code': {
      // Fenced blocks without a language get the inline-code tint; indented
      // blocks stay plain.
      if (!token.lang && token.codeBlockStyle !== 'indented') {
        const tint = color('permission', theme)
        return token.text.replace(/\S(?:.*\S)?/g, s => tint(s)) + EOL
      }
      const lang = token.lang ?? ''
      // Unknown language: show its name dimmed above the block.
      const label =
        lang && !highlight?.supportsLanguage(lang) ? chalk.dim(lang) + EOL : ''
      if (!highlight) {
        return label + token.text + EOL
      }
      // Accept info strings like "js title=x" by falling back to the first word.
      const firstWord = lang.match(/^[\w.+#-]+/)?.[0] ?? ''
      let language = 'plaintext'
      if (highlight.supportsLanguage(lang)) {
        language = lang
      } else if (highlight.supportsLanguage(firstWord)) {
        language = firstWord
      } else if (lang) {
        logForDebugging(
          `Language not supported while highlighting code, falling back to plaintext: ${lang}`,
        )
      }
      return label + highlight.highlight(token.text, { language }) + EOL
    }
    case 'codespan': {
      // inline code
      return color('permission', theme)(token.text)
    }
    case 'em':
      return chalk.italic(
        (token.tokens ?? [])
          .map(_ => formatToken(_, theme, 0, null, parent, highlight))
          .join(''),
      )
    case 'strong':
      return chalk.bold(
        (token.tokens ?? [])
          .map(_ => formatToken(_, theme, 0, null, parent, highlight))
          .join(''),
      )
    case 'heading':
      switch (token.depth) {
        case 1: // h1
          return (
            chalk.bold.italic.underline(
              (token.tokens ?? [])
                .map(_ => formatToken(_, theme, 0, null, null, highlight))
                .join(''),
            ) +
            EOL +
            EOL
          )
        case 2: // h2
          return (
            chalk.bold(
              (token.tokens ?? [])
                .map(_ => formatToken(_, theme, 0, null, null, highlight))
                .join(''),
            ) +
            EOL +
            EOL
          )
        default: // h3+
          return (
            chalk.bold(
              (token.tokens ?? [])
                .map(_ => formatToken(_, theme, 0, null, null, highlight))
                .join(''),
            ) +
            EOL +
            EOL
          )
      }
    case 'hr':
      return '---'
    case 'image': {
      // Alt text followed by the URL; a bare image shows only the URL.
      const url = sanitizeDisplay(token.href)
      const title = token.title ? ` "${token.title}"` : ''
      if (!token.text && !token.title) return url
      return token.text ? `${token.text} (${url}${title})` : `(${url}${title})`
    }
    case 'link': {
      const title = token.title ? ` ("${token.title}")` : ''
      // mailto: links are never clickable; show the address, after the text if it differs.
      if (/^mailto:/i.test(token.href)) {
        const email = sanitizeDisplay(token.href.replace(/^mailto:/i, ''))
        if (token.text && token.text !== email) {
          return `${token.text} (${email})${title}`
        }
        return email + title
      }
      const url = sanitizeDisplay(token.href)
      // Clickable only when the terminal supports OSC 8 and the URL is a plain web address.
      const clickable = supportsHyperlinks() && isWebDisplayableUrl(token.href)
      const linkText = (token.tokens ?? [])
        .map(_ => formatToken(_, theme, 0, null, token, highlight))
        .join('')
      const plainLinkText = stripAnsi(linkText)
      if (!plainLinkText || plainLinkText === token.href) {
        return createHyperlink(url, undefined, { supportsHyperlinks: clickable }) + title
      }
      // Text that is just the URL (with or without scheme) is shown as the URL.
      const textIsUrl =
        plainLinkText === `http://${url}` || plainLinkText === `https://${url}`
      if (clickable) {
        const shown = textIsUrl ? sanitizeDisplay(plainLinkText) : linkText
        const urlSuffix = token.title ? ` (${url})` : ''
        return (
          createHyperlink(url, shown, { supportsHyperlinks: true }) +
          urlSuffix +
          title
        )
      }
      return (textIsUrl ? url : `${linkText} (${url})`) + title
    }
    case 'list': {
      return token.items
        .map((_: Token, index: number) =>
          formatToken(
            _,
            theme,
            listDepth,
            token.ordered ? token.start + index : null,
            token,
            highlight,
          ),
        )
        .join('')
    }
    case 'list_item': {
      const indent = '  '.repeat(listDepth)
      const bullet =
        orderedListNumber === null
          ? '-'
          : getListNumber(listDepth + 1, orderedListNumber) + '.'
      const marker = token.task
        ? `${bullet} ${token.checked ? '[x]' : '[ ]'}`
        : bullet
      const rendered = (token.tokens ?? [])
        .map(_ =>
          formatToken(_, theme, listDepth + 1, orderedListNumber, token, highlight),
        )
        .join('')
      const out = `${indent}${marker} ${rendered}`
      return out.endsWith(EOL) ? out : out + EOL
    }
    case 'paragraph':
      return (
        (token.tokens ?? [])
          .map(_ => formatToken(_, theme, 0, null, null, highlight))
          .join('') + EOL
      )
    case 'space':
      return EOL
    case 'br':
      return EOL
    case 'text':
      if (parent?.type === 'link') {
        // Already inside a markdown link — the link handler will wrap this
        // in an OSC 8 hyperlink. Linkifying here would nest a second OSC 8
        // sequence, and terminals honor the innermost one, overriding the
        // link's actual href.
        return token.text
      }
      {
        const rendered = token.tokens
          ? token.tokens
              .map(_ =>
                formatToken(_, theme, listDepth, orderedListNumber, token, highlight),
              )
              .join('')
          : linkifyIssueReferences(
              token.escaped === true
                ? token.text
                : token.text.replace(NBSP_ENTITY_RE, ' '),
            )
        // Under list_item, append EOL so a following nested list (or sibling
        // text) starts on its own line. list_item itself owns the bullet now.
        return parent?.type === 'list_item' ? rendered + EOL : rendered
      }
    case 'table': {
      const tableToken = token as Tokens.Table

      // Helper function to get the text content that will be displayed (after stripAnsi)
      function getDisplayText(tokens: Token[] | undefined): string {
        return stripAnsi(
          tokens
            ?.map(_ => formatToken(_, theme, 0, null, null, highlight))
            .join('') ?? '',
        )
      }

      // Determine column widths based on displayed content (without formatting)
      const columnWidths = tableToken.header.map((header, index) => {
        let maxWidth = stringWidth(getDisplayText(header.tokens))
        for (const row of tableToken.rows) {
          const cellLength = stringWidth(getDisplayText(row[index]?.tokens))
          maxWidth = Math.max(maxWidth, cellLength)
        }
        return Math.max(maxWidth, 3) // Minimum width of 3
      })

      let tableOutput = '| '
      tableToken.header.forEach((header, index) => {
        const content =
          header.tokens
            ?.map(_ => formatToken(_, theme, 0, null, null, highlight))
            .join('') ?? ''
        const displayText = getDisplayText(header.tokens)
        const width = columnWidths[index]!
        const align = tableToken.align?.[index]
        tableOutput +=
          padAligned(content, stringWidth(displayText), width, align) + ' | '
      })
      tableOutput = tableOutput.trimEnd() + EOL

      tableOutput += '|'
      columnWidths.forEach(width => {
        // Always use dashes, don't show alignment colons in the output
        const separator = '-'.repeat(width + 2) // +2 for spaces on each side
        tableOutput += separator + '|'
      })
      tableOutput += EOL

      tableToken.rows.forEach(row => {
        tableOutput += '| '
        row.forEach((cell, index) => {
          const content =
            cell.tokens
              ?.map(_ => formatToken(_, theme, 0, null, null, highlight))
              .join('') ?? ''
          const displayText = getDisplayText(cell.tokens)
          const width = columnWidths[index]!
          const align = tableToken.align?.[index]
          tableOutput +=
            padAligned(content, stringWidth(displayText), width, align) + ' | '
        })
        tableOutput = tableOutput.trimEnd() + EOL
      })

      return tableOutput + EOL
    }
    case 'del': {
      const inner = (token.tokens ?? [])
        .map(_ => formatToken(_, theme, 0, null, parent, highlight))
        .join('')
      return chalk.level > 0 && supportsStrikethrough()
        ? chalk.strikethrough(inner)
        : `~~${inner}~~`
    }
    case 'escape':
      // Markdown escape: \) → ), \\ → \, etc.
      return token.text
    case 'def':
    case 'html':
      // These token types are not rendered
      return ''
  }
  return ''
}

// Matches owner/repo#NNN style GitHub issue/PR references. The qualified form
// is unambiguous — bare #NNN was removed because it guessed the current repo
// and was wrong whenever the assistant discussed a different one.
// Owner segment disallows dots (GitHub usernames are alphanumerics + hyphens
// only) so hostnames like docs.github.io/guide#42 don't false-positive. Repo
// segment allows dots (e.g. cc.kurs.web). Lookbehind is avoided — it defeats
// YARR JIT in JSC.
const ISSUE_REF_PATTERN =
  /(^|[^\w./-])([A-Za-z0-9][\w-]*\/[A-Za-z0-9][\w.-]*)#(\d+)\b/g

/**
 * Replaces owner/repo#123 references with clickable hyperlinks to GitHub.
 */
function linkifyIssueReferences(text: string): string {
  if (!supportsHyperlinks()) {
    return text
  }
  return text.replace(
    ISSUE_REF_PATTERN,
    (_match, prefix, repo, num) =>
      prefix +
      createHyperlink(
        `https://github.com/${repo}/issues/${num}`,
        `${repo}#${num}`,
      ),
  )
}

function numberToLetter(n: number): string {
  let result = ''
  while (n > 0) {
    n--
    result = String.fromCharCode(97 + (n % 26)) + result
    n = Math.floor(n / 26)
  }
  return result
}

const ROMAN_VALUES: ReadonlyArray<[number, string]> = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
]

function numberToRoman(n: number): string {
  let result = ''
  for (const [value, numeral] of ROMAN_VALUES) {
    while (n >= value) {
      result += numeral
      n -= value
    }
  }
  return result
}

function getListNumber(listDepth: number, orderedListNumber: number): string {
  switch (listDepth) {
    case 0:
    case 1:
      return orderedListNumber.toString()
    case 2:
      return numberToLetter(orderedListNumber)
    case 3:
      return numberToRoman(orderedListNumber)
    default:
      return orderedListNumber.toString()
  }
}

// Bullet or number for item `index` of `list`, as formatToken draws it.
export function getListMarker(
  list: Tokens.List,
  index: number,
  listDepth: number,
): string {
  return list.ordered
    ? getListNumber(listDepth + 1, list.start + index) + '.'
    : '-'
}

/**
 * Pad `content` to `targetWidth` according to alignment. `displayWidth` is the
 * visible width of `content` (caller computes this, e.g. via stringWidth on
 * stripAnsi'd text, so ANSI codes in `content` don't affect padding).
 */
export function padAligned(
  content: string,
  displayWidth: number,
  targetWidth: number,
  align: 'left' | 'center' | 'right' | null | undefined,
): string {
  const padding = Math.max(0, targetWidth - displayWidth)
  if (align === 'center') {
    const leftPad = Math.floor(padding / 2)
    return ' '.repeat(leftPad) + content + ' '.repeat(padding - leftPad)
  }
  if (align === 'right') {
    return ' '.repeat(padding) + content
  }
  return content + ' '.repeat(padding)
}
