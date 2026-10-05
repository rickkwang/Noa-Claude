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

  // Compound statements are decomposed by splitCommand_DEPRECATED while the
  // tree-sitter path is off, and it shreds them into fragments that parse as
  // nothing: `if true; then rm -rf /; fi` becomes ["if true", "then rm -rf /",
  // "fi"], so no subcommand reads as a removal and the call collapses to a
  // subcommandResults passthrough that bypassPermissions auto-approves.
  test.each([
    'if true; then rm -rf /; fi',
    'if [ -d /x ]; then rm -rf .; fi',
    'while true; do rm -rf /; done',
    'until false; do rm -rf ~; done',
    'for f in a; do rm -rf /; done',
    'case x in x) rm -rf /;; esac',
    'npm ci && if true; then rm -rf /; fi',
  ])('%s cannot hide the removal in a compound statement', async command => {
    const result = await decide(command, ['Bash(rm:*)', 'Bash(npm:*)'])
    expect(result.behavior).toBe('ask')
    expect(result.decisionReason?.type).toBe('safetyCheck')
  })

  // The compound-statement keywords are a coarse pre-filter over raw command
  // text, so the removals they reach must still be judged on their targets —
  // ordinary cleanup loops keep whatever decision they had.
  test.each([
    ['for d in */; do rm -rf "$d/dist"; done', []],
    ['for f in *.log; do rm -f "$f"; done', []],
    ['if [ -d dist ]; then rm -rf dist; fi', []],
    ['while read f; do rm -f "build/$f"; done < list', []],
  ])('%s is ordinary cleanup, not a catastrophic removal', async (command, rules) => {
    const result = await decide(command, rules as string[])
    expect(result.decisionReason?.type).not.toBe('safetyCheck')
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

  // A wrapper, eval or `sh -c` used to carry the removal past the guard: the
  // ordinary check never strips sudo, and `sudo -u root` read `root` as the
  // command, so an allow rule ran these without a prompt in every mode.
  test.each([
    'sudo rm -rf /',
    'sudo -u root rm -rf /',
    'sudo -u root rm -rf $HOME',
    'doas -u root rm -rf /',
    'env -u FOO rm -rf /',
    'eval rm -rf /',
    'bash -c "rm -rf /"',
    "sh -c 'rm -rf /'",
    'find $HOME -delete',
    'find / -xdev -delete',
    'sudo find $HOME -mindepth 1 -delete',
    // Actions that print instead of filter, and global options before the path.
    'find $HOME -print -delete',
    'find $HOME -true -delete',
    'find -L $HOME -delete',
    'find -H / -delete',
    'find -O3 / -delete',
    'find -D tree $HOME -delete',
  ])('%s cannot hide the removal behind a wrapper', async command => {
    const result = await decide(command, ['Bash(rm:*)', 'Bash(sudo:*)', 'Bash(doas:*)', 'Bash(env:*)', 'Bash(find:*)'])
    expect(result.behavior).toBe('ask')
    expect(result.decisionReason?.type).toBe('safetyCheck')
  })

  // Expansions that cannot reach a critical path: `$(pwd)/build` names a real
  // directory, `${X:?}` aborts the shell instead of expanding to nothing, and a
  // filtered `find -delete` only removes what matches.
  test.each([
    ['rm -rf "$(pwd)/build"', ['Bash(rm:*)']],
    ['rm -rf $(git rev-parse --show-toplevel)/dist', ['Bash(rm:*)']],
    ['rm -rf "${OUT_DIR:?}/dist"', ['Bash(rm:*)']],
    ['sudo rm -rf ./build', ['Bash(sudo:*)']],
    ["find . -name '*.o' -delete", ['Bash(find:*)']],
    ['find / -name x -delete', ['Bash(find:*)']],
    ['find -L . -name "*.o" -print -delete', ['Bash(find:*)']],
  ])('%s is not a catastrophic removal', async (command, rules) => {
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
    ['git commit -m "if true; then rm -rf /; fi"', ['Bash(git:*)']],
    ['echo "for f in x; do rm -rf /; done"', ['Bash(echo:*)']],
    ['grep -rn "rm -rf /" src', ['Bash(grep:*)']],
  ])('%s is quoted text, not a removal', async (command, rules) => {
    const result = await decide(command, rules)
    expect(result.behavior).toBe('allow')
  })
})
