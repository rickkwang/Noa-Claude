// @ts-nocheck
/**
 * Utility for substituting $ARGUMENTS placeholders in skill/command prompts.
 *
 * Supports:
 * - $ARGUMENTS - replaced with the full arguments string
 * - $ARGUMENTS[0], $ARGUMENTS[1], etc. - replaced with individual indexed arguments
 * - $0, $1, etc. - shorthand for $ARGUMENTS[0], $ARGUMENTS[1]
 * - Named arguments (e.g., $foo, $bar) - when argument names are defined in frontmatter
 *
 * Arguments are parsed using shell-quote for proper shell argument handling.
 */

import { tryParseShellCommand } from './bash/shellQuote.js'

const MAX_ARGUMENT_NAMES = 64
const MAX_ARGUMENT_NAME_LENGTH = 64

/**
 * Parse an arguments string into an array of individual arguments.
 * Uses shell-quote for proper shell argument parsing including quoted strings.
 *
 * Examples:
 * - "foo bar baz" => ["foo", "bar", "baz"]
 * - 'foo "hello world" baz' => ["foo", "hello world", "baz"]
 * - "foo 'hello world' baz" => ["foo", "hello world", "baz"]
 */
export function parseArguments(args: string): string[] {
  if (!args || !args.trim()) {
    return []
  }

  // Return $KEY to preserve variable syntax literally (don't expand variables)
  const result = tryParseShellCommand(args, key => `$${key}`)
  if (!result.success) {
    // Fall back to simple whitespace split if parsing fails
    return args.split(/\s+/).filter(Boolean)
  }

  // Filter to only string tokens (ignore shell operators, etc.)
  return result.tokens.filter(
    (token): token is string => typeof token === 'string',
  )
}

/**
 * Parse argument names from the frontmatter 'arguments' field.
 * Accepts either a space-separated string or an array of strings.
 *
 * Examples:
 * - "foo bar baz" => ["foo", "bar", "baz"]
 * - ["foo", "bar", "baz"] => ["foo", "bar", "baz"]
 */
export function parseArgumentNames(
  argumentNames: string | string[] | undefined,
): string[] {
  if (!argumentNames) {
    return []
  }

  // Filter out empty strings and numeric-only names (which conflict with $0, $1 shorthand)
  const isValidName = (name: string): boolean =>
    typeof name === 'string' && name.trim() !== '' && !/^\d+$/.test(name)
  // Empty slots preserve the position of names too long to expand safely.
  const boundName = (name: string): string => name.length <= MAX_ARGUMENT_NAME_LENGTH ? name : ''

  if (Array.isArray(argumentNames)) {
    return argumentNames.slice(0, MAX_ARGUMENT_NAMES).filter(isValidName).map(boundName)
  }
  if (typeof argumentNames === 'string') {
    return argumentNames.trim().split(/\s+/, MAX_ARGUMENT_NAMES).filter(isValidName).map(boundName)
  }
  return []
}

/**
 * Generate argument hint showing remaining unfilled args.
 * @param argNames - Array of argument names from frontmatter
 * @param typedArgs - Arguments the user has typed so far
 * @returns Hint string like "[arg2] [arg3]" or undefined if all filled
 */
export function generateProgressiveArgumentHint(
  argNames: string[],
  typedArgs: string[],
): string | undefined {
  const remaining = argNames.slice(typedArgs.length).filter(Boolean)
  if (remaining.length === 0) return undefined
  return remaining.map(name => `[${name}]`).join(' ')
}

/**
 * Sentinel characters used while substituting. \uFFFF temporarily stands in
 * for a literal `$` inside an inserted value; \uFFFE wraps the value so it
 * can be removed again after all passes complete.
 */
const DOLLAR_SENTINEL = '\uFFFF'
const VALUE_WRAP = '\uFFFE'

function neutralizeSentinels(value: string): string {
  return value
    .replaceAll(DOLLAR_SENTINEL, '\uFFFD')
    .replaceAll(VALUE_WRAP, '\uFFFD')
}

/** Mask a value for insertion: it must not be scanned by later passes. */
function formatInsertedValue(value: string): string {
  const masked = neutralizeSentinels(value).replaceAll('$', DOLLAR_SENTINEL)
  return VALUE_WRAP + masked + VALUE_WRAP
}

/**
 * Substitute $ARGUMENTS placeholders in content with actual argument values.
 *
 * Inserted values are masked so their `$` can never be re-read as a
 * placeholder by a later substitution pass (e.g. an argument value of
 * `$ARGUMENTS` or `$1` stays literal). \uFFFF marks a masked dollar and
 * \uFFFE wraps each inserted value; both are restored/stripped at the end.
 *
 * @param content - The content containing placeholders
 * @param args - The raw arguments string (may be undefined/null)
 * @param appendIfNoPlaceholder - If true and no placeholders are found, appends "ARGUMENTS: {args}" to content
 * @param argumentNames - Optional array of named arguments (e.g., ["foo", "bar"]) that map to indexed positions
 * @returns The content with placeholders substituted
 */
export function substituteArguments(
  content: string,
  args: string | undefined,
  appendIfNoPlaceholder = true,
  argumentNames: string[] = [],
): string {
  // undefined/null means no args provided - return content unchanged
  // empty string is a valid input that should replace placeholders with empty
  if (args === undefined || args === null) {
    return content
  }

  // The template must not be able to spoof the sentinels used below.
  content = neutralizeSentinels(content)
  const originalContent = content

  const parsedArgs = parseArguments(args)

  // Replace named arguments (e.g., $foo, $bar) with their values
  // Named arguments map to positions: argumentNames[0] -> parsedArgs[0], etc.
  for (let i = 0; i < Math.min(argumentNames.length, MAX_ARGUMENT_NAMES); i++) {
    const name = argumentNames[i]
    if (!name || name.length > MAX_ARGUMENT_NAME_LENGTH) continue

    // Match $name but not $name[...] or $nameXxx (word chars)
    // Also ensure we match word boundaries to avoid partial matches
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    content = content.replace(
      new RegExp(`\\$${escapedName}(?![\\[\\w])`, 'g'),
      () => formatInsertedValue(parsedArgs[i] ?? ''),
    )
  }

  // Replace indexed arguments ($ARGUMENTS[0], $ARGUMENTS[1], etc.)
  content = content.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, indexStr: string) => {
    const index = parseInt(indexStr, 10)
    return formatInsertedValue(parsedArgs[index] ?? '')
  })

  // Replace shorthand indexed arguments ($0, $1, etc.)
  content = content.replace(/\$(\d+)(?!\w)/g, (_, indexStr: string) => {
    const index = parseInt(indexStr, 10)
    return formatInsertedValue(parsedArgs[index] ?? '')
  })

  // Replace $ARGUMENTS with the full arguments string
  content = content.replaceAll('$ARGUMENTS', () => formatInsertedValue(args))

  // If no placeholders were found and appendIfNoPlaceholder is true, append
  // But only if args is non-empty (empty string means command invoked with no args)
  if (content === originalContent && appendIfNoPlaceholder && args) {
    content = content + `\n\nARGUMENTS: ${formatInsertedValue(args)}`
  }

  return content.replaceAll(DOLLAR_SENTINEL, '$').replaceAll(VALUE_WRAP, '')
}
