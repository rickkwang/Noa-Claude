import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import {
  checkPathConstraints,
  PATH_EXTRACTORS,
} from '../../../tools/BashTool/pathValidation.js'
import { checkReadOnlyConstraints } from '../../../tools/BashTool/readOnlyValidation.js'

// validatePath reaches getBundledSkillsRoot(), which interpolates MACRO, a
// build-time global the bundler injects.
;(globalThis as { MACRO?: unknown }).MACRO ??= { VERSION: 'test' }

const OUTSIDE = '/etc/passwd'

function pathBehavior(command: string): string {
  return checkPathConstraints(
    { command } as never,
    process.cwd(),
    getEmptyToolPermissionContext(),
  ).behavior
}

describe('Bash path extraction for auto-allowed text readers', () => {
  // Every one of these is auto-allowed as read-only, so a file the extractor
  // misses is read without a prompt.
  test.each([
    `fmt ${OUTSIDE}`,
    `tac ${OUTSIDE}`,
    `rev ${OUTSIDE}`,
    `fold -w 80 ${OUTSIDE}`,
    `expand -t 4 ${OUTSIDE}`,
    `unexpand -a ${OUTSIDE}`,
    `comm -3 ${OUTSIDE} README.md`,
    `cmp README.md ${OUTSIDE}`,
    `pr -h title ${OUTSIDE}`,
    `numfmt --from=iec ${OUTSIDE}`,
    `tsort ${OUTSIDE}`,
    `man -l ${OUTSIDE}`,
    `column -t ${OUTSIDE}`,
  ])('%s asks for a file outside the workspace', command => {
    expect(checkReadOnlyConstraints({ command } as never, false).behavior).toBe(
      'allow',
    )
    expect(pathBehavior(command)).toBe('ask')
  })

  test('an unrecognized option stops later options from swallowing the file', () => {
    // GNU fmt reads `-w` as the -p prefix, so /etc/passwd is the input file.
    expect(PATH_EXTRACTORS.fmt(['-p', '-w', OUTSIDE])).toContain(OUTSIDE)
    expect(PATH_EXTRACTORS.column(['-Z', '-s', OUTSIDE])).toContain(OUTSIDE)
    expect(PATH_EXTRACTORS.pr(['--bogus', '-h', OUTSIDE])).toContain(OUTSIDE)
    expect(pathBehavior(`fmt -p -w ${OUTSIDE}`)).toBe('ask')
    expect(pathBehavior(`column -Z -s ${OUTSIDE}`)).toBe('ask')
  })

  test('known valued options skip their value, bundled or separate', () => {
    expect(PATH_EXTRACTORS.fmt(['-w', '80', 'a.txt'])).toEqual(['a.txt'])
    expect(PATH_EXTRACTORS.fmt(['-uw', '80', 'a.txt'])).toEqual(['a.txt'])
    expect(PATH_EXTRACTORS.fmt(['-w80', 'a.txt'])).toEqual(['a.txt'])
    expect(PATH_EXTRACTORS.fmt(['--width=80', 'a.txt'])).toEqual(['a.txt'])
    expect(PATH_EXTRACTORS.cut(['-d', '/', '-f1', 'a.txt'])).toEqual(['a.txt'])
    expect(PATH_EXTRACTORS.pr(['-n', '-h', 'x', 'a.txt'])).toEqual(['a.txt'])
    expect(pathBehavior('cut -d / -f1 README.md')).toBe('passthrough')
  })

  test('-- and everything after the first operand are operands', () => {
    expect(PATH_EXTRACTORS.fmt(['--', '-w'])).toEqual(['-w'])
    expect(PATH_EXTRACTORS.fmt(['a.txt', '-w', OUTSIDE])).toEqual([
      'a.txt',
      '-w',
      OUTSIDE,
    ])
  })

  test('filterOutFlags treats everything after the first operand as operands', () => {
    // BSD getopt stops at the first operand, so `-/../x` here is a file.
    expect(PATH_EXTRACTORS.rev(['a.txt', '-/../x'])).toEqual(['a.txt', '-/../x'])
    expect(PATH_EXTRACTORS.cat(['-n', 'a.txt', '-/../x'])).toEqual([
      'a.txt',
      '-/../x',
    ])
    expect(PATH_EXTRACTORS.ls(['-la'])).toEqual(['.'])
    expect(pathBehavior('cat README.md -/../../../etc/passwd')).toBe('ask')
  })

  test('man page names are not paths unless -l is given', () => {
    expect(PATH_EXTRACTORS.man(['ls'])).toEqual([])
    expect(PATH_EXTRACTORS.man(['-l', 'page.1'])).toEqual(['page.1'])
    expect(PATH_EXTRACTORS.man(['./page.1'])).toEqual(['./page.1'])
    expect(pathBehavior('man ls')).toBe('passthrough')
  })
})
