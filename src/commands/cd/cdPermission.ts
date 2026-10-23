import chalk from 'chalk'
import { relative } from 'path'
import type { ToolPermissionContext } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import {
  patternWithRoot,
} from '../../utils/permissions/filesystem.js'
import {
  permissionRuleValueToString,
} from '../../utils/permissions/permissionRuleParser.js'
import {
  getAllowRules,
  getDenyRules,
  permissionRuleSourceDisplayString,
} from '../../utils/permissions/permissions.js'
import type { PermissionRule } from '../../utils/permissions/PermissionRule.js'

const CD_TOOL_NAME = 'Cd'

export type CdPermissionResult =
  | { result: 'allowed' }
  | { result: 'blockedByRule'; rule: PermissionRule }
  | { result: 'outsideAllowedPatterns'; allowedPatterns: string[] }

/**
 * `Cd(pattern)` rules gate /cd. A content-less deny turns /cd off; a deny
 * pattern excludes matching directories; any content-less allow is
 * unrestricted, otherwise the target must match one of the allow patterns.
 */
export function checkCdPermission(
  { requestedPath, canonicalPath }: { requestedPath: string; canonicalPath: string },
  context: ToolPermissionContext,
): CdPermissionResult {
  const requestedSpellings = [...new Set([requestedPath, canonicalPath])]
  for (const rule of getDenyRules(context)) {
    if (rule.ruleValue.toolName !== CD_TOOL_NAME) continue
    const content = rule.ruleValue.ruleContent
    if (content === undefined || matchesCdPattern(content, rule.source, requestedSpellings)) {
      return { result: 'blockedByRule', rule }
    }
  }

  const allowRules = getAllowRules(context).filter(
    rule => rule.ruleValue.toolName === CD_TOOL_NAME,
  )
  if (allowRules.length === 0) return { result: 'allowed' }
  for (const rule of allowRules) {
    const content = rule.ruleValue.ruleContent
    if (content === undefined || matchesCdPattern(content, rule.source, [canonicalPath])) {
      return { result: 'allowed' }
    }
  }
  return {
    result: 'outsideAllowedPatterns',
    allowedPatterns: allowRules
      .map(rule => rule.ruleValue.ruleContent)
      .filter((content): content is string => content !== undefined),
  }
}

export function describeCdPermissionDenial(
  result: CdPermissionResult,
  directory: string,
): string {
  const bold = chalk.bold
  if (result.result === 'blockedByRule') {
    const { rule } = result
    const ruleText = bold(permissionRuleValueToString(rule.ruleValue))
    const sourceText = permissionRuleSourceDisplayString(rule.source)
    if (rule.ruleValue.ruleContent === undefined) {
      return `Can't move to ${bold(directory)} — /cd is turned off by the ${ruleText} rule in ${sourceText}. Update the rule in /permissions to move between directories again.`
    }
    return `Can't move to ${bold(directory)} — it's excluded by the ${ruleText} rule in ${sourceText}. Pick a directory outside that rule, or update it in /permissions.`
  }
  if (result.result === 'outsideAllowedPatterns') {
    const patterns = result.allowedPatterns.map(pattern => bold(pattern)).join(', ')
    return `Can't move to ${bold(directory)} — /cd is limited to directories matching ${patterns}. Pick a matching directory, or add a Cd rule in /permissions.`
  }
  return ''
}

function matchesCdPattern(
  pattern: string,
  source: PermissionRule['source'],
  absolutePaths: string[],
): boolean {
  return absolutePaths.some(absolutePath => {
    const { relativePattern, root } = patternWithRoot(pattern, source)
    const pathFromRoot = relative(root ?? getCwd(), absolutePath)
    if (pathFromRoot === '..' || pathFromRoot.startsWith('../')) return false
    const normalized = relativePattern
      .replace(/\/{2,}/g, '/')
      .replace(/^\//, '')
      .replace(/\/$/, '')
    return globToRegExp(normalized).test(pathFromRoot)
  })
}

// Glob → regex: `**/` matches any leading directories, `/**` any suffix,
// `*` one path segment.
function globToRegExp(pattern: string): RegExp {
  let source = '^'
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (i === 0 && char === '*' && pattern[1] === '*' && pattern[2] === '/') {
      source += '(?:.*/)?'
      i += 2
    } else if (char === '/' && pattern[i + 1] === '*' && pattern[i + 2] === '*') {
      source += '(/.*)?'
      i += 2
    } else if (char === '*') {
      if (pattern[i + 1] === '*') {
        source += '.*'
        i++
      } else {
        source += '[^/]+'
      }
    } else if ('\\^$.|?+()[]{}'.includes(char!)) {
      source += `\\${char}`
    } else {
      source += char
    }
  }
  return new RegExp(`${source}$`, 'i')
}
