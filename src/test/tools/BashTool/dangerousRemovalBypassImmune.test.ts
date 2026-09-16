import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { bashToolHasPermission } from '../../../tools/BashTool/bashPermissions.js'

// validatePath reaches getBundledSkillsRoot(), which interpolates MACRO, a
// build-time global the bundler injects.
;(globalThis as { MACRO?: unknown }).MACRO ??= { VERSION: 'test' }

async function decide(
  command: string,
  allowRules: string[] = [],
  mode = 'default',
) {
  const toolPermissionContext = {
    ...getEmptyToolPermissionContext(),
    mode,
    alwaysAllowRules: { localSettings: allowRules },
  }
  const context = {
    getAppState: () => ({ toolPermissionContext }),
    abortController: new AbortController(),
    options: { isNonInteractiveSession: false },
  }
  return await bashToolHasPermission(
    { command } as never,
    context as never,
  )
}

// hasPermissionsToUseTool step 1g holds back any {type:'safetyCheck'} ask in
// bypassPermissions mode; an {type:'other'} ask is auto-approved there. The
// type is therefore the load-bearing assertion. classifierApprovable stays
// true so auto mode still routes the call to the classifier.
describe('catastrophic removals stay bypass-immune', () => {
  test.each([
    'rm -rf /',
    'rm -rf ~',
    'rm -rf .',
    'rm -rf ..',
    'timeout 5 rm -rf /',
  ])('%s asks with a non-approvable safety check', async command => {
    const result = await decide(command, ['Bash(rm:*)'])
    expect(result.behavior).toBe('ask')
    expect(result.decisionReason?.type).toBe('safetyCheck')
  })

  // Constructs the checker never decomposes into subcommands used to collapse
  // to a generic {type:'other'} ask, which bypassPermissions auto-approves.
  test.each([
    '(rm -rf /)',
    '(rm -rf .)',
    '{ rm -rf /; }',
    'echo $(rm -rf /)',
    'echo `rm -rf /`',
    'echo "$(rm -rf /)"',
    'echo "`rm -rf ~`"',
    'x=$(rm -rf ~) ; echo $x',
    'cat <(rm -rf /)',
    'git status && (rm -rf .)',
  ])('%s cannot hide the removal', async command => {
    const result = await decide(command, ['Bash(rm:*)', 'Bash(echo:*)'])
    expect(result.behavior).toBe('ask')
    expect(result.decisionReason?.type).toBe('safetyCheck')
  })

  test.each([['bypassPermissions'], ['acceptEdits'], ['auto']])(
    'a subshell removal still asks in %s mode',
    async mode => {
      const result = await decide('(rm -rf /)', ['Bash(rm:*)'], mode)
      expect(result.behavior).toBe('ask')
      expect(result.decisionReason?.type).toBe('safetyCheck')
    },
  )

  test('an exact deny rule still wins over the safety check', async () => {
    const toolPermissionContext = {
      ...getEmptyToolPermissionContext(),
      mode: 'default',
      alwaysDenyRules: { localSettings: ['Bash((rm -rf /))'] },
    }
    const context = {
      getAppState: () => ({ toolPermissionContext }),
      abortController: new AbortController(),
      options: { isNonInteractiveSession: false },
    }
    const result = await bashToolHasPermission(
      { command: '(rm -rf /)' } as never,
      context as never,
    )
    expect(result.behavior).toBe('deny')
  })

  test.each([
    ['(rm -rf build)', ['Bash(rm:*)']],
    ['docker run --rm -it ubuntu', ['Bash(docker:*)']],
    ['echo "docker run --rm x"', ['Bash(echo:*)']],
  ])('%s keeps its existing decision', async (command, rules) => {
    const result = await decide(command, rules)
    expect(result.decisionReason?.type).not.toBe('safetyCheck')
  })

  // A removal the shell would never run is text, not a command. Reading it as
  // one turned `git commit -m "drop (rm -rf /) from docs"` into a prompt.
  test.each([
    ['echo "rm -rf / (x)"', ['Bash(echo:*)']],
    ['echo "use rm -rf / carefully"', ['Bash(echo:*)']],
    [`echo '(rm -rf /)'`, ['Bash(echo:*)']],
    ['git commit -m "drop (rm -rf /) from docs"', ['Bash(git:*)']],
  ])('%s is quoted text, not a removal', async (command, rules) => {
    const result = await decide(command, rules)
    expect(result.behavior).toBe('allow')
  })
})
