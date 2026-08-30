import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { checkWorktreeEscape } from '../../utils/worktreeEscape.js'

// `isolation: "worktree"` is only a real boundary if writes are held to it.
// The agent runs under a cwd override (AgentTool wraps its execution in
// runWithCwdOverride), but nothing stopped it from naming an absolute path
// back in the shared checkout — which silently undoes the isolation the
// caller asked for. These pin the shape of that guard.
describe('checkWorktreeEscape', () => {
  const shared = '/repo'
  // Worktrees live at `.noa/worktrees/<slug>`, i.e. *inside* the shared
  // checkout. The containment checks must therefore be ordered innermost
  // first, or every worktree path reads as a shared-checkout path.
  const worktree = join(shared, '.noa', 'worktrees', 'agent-1234abcd')
  const isolated = { cwd: worktree, sharedCheckout: shared }

  test('no cwd override means no guard', () => {
    expect(checkWorktreeEscape(join(shared, 'src/a.ts'), undefined)).toBe(null)
  })

  // The reason this keys on the override rather than on
  // `getCwd() !== getOriginalCwd()`: a `cd` in the shell moves the cwd for
  // the whole session, and reading that as an isolation boundary would
  // refuse every ordinary write from then on.
  test('a plain cd in the shell is not a boundary', () => {
    expect(checkWorktreeEscape(join(shared, 'README.md'), undefined)).toBe(null)
  })

  test('paths inside the worktree are allowed', () => {
    expect(checkWorktreeEscape(join(worktree, 'src/a.ts'), isolated)).toBe(null)
    expect(checkWorktreeEscape(worktree, isolated)).toBe(null)
  })

  test('paths in the shared checkout are refused', () => {
    const message = checkWorktreeEscape(join(shared, 'src/a.ts'), isolated)
    expect(message).toBeString()
    // The message has to carry the worktree path: the agent's only way out is
    // to retarget the write, and it cannot do that without being told where.
    expect(message).toContain(worktree)
  })

  test('the worktree parent chain is still refused', () => {
    // `.noa/worktrees` and `.noa` sit between the worktree and the checkout
    // root. They are outside the worktree, so they are shared state.
    expect(
      checkWorktreeEscape(join(shared, '.noa', 'settings.json'), isolated),
    ).toBeString()
  })

  test('paths outside the shared checkout are not our business', () => {
    // Scratch space is a legitimate destination and never a lost update in
    // the repo. Guarding it would be a sandbox, which this is not.
    expect(checkWorktreeEscape('/tmp/scratch.txt', isolated)).toBe(null)
    expect(checkWorktreeEscape('/other/repo/a.ts', isolated)).toBe(null)
  })

  test('traversal out of the worktree is refused', () => {
    expect(
      checkWorktreeEscape(
        join(worktree, '..', '..', '..', 'src/a.ts'),
        isolated,
      ),
    ).toBeString()
  })

  test('an explicit cwd override outside the checkout still guards', () => {
    // AgentTool sets the same override for an explicit `cwd` argument, not
    // just worktrees, so the guard must not assume containment either way.
    const elsewhere = { cwd: '/somewhere/else', sharedCheckout: shared }
    expect(checkWorktreeEscape('/somewhere/else/a.ts', elsewhere)).toBe(null)
    expect(checkWorktreeEscape(join(shared, 'src/a.ts'), elsewhere)).toBeString()
  })
})

// A textual containment test is not enough: a symlink inside the worktree
// pointing at the shared checkout reads as contained, and writing through it
// lands in the checkout all the same. One `ln -s` would otherwise retire the
// whole guard, so this uses real files rather than string fixtures.
describe('checkWorktreeEscape follows symlinks', () => {
  let root: string
  let repo: string
  let worktree: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'wt-escape-'))
    repo = join(root, 'repo')
    worktree = join(repo, '.noa', 'worktrees', 'a1')
    mkdirSync(worktree, { recursive: true })
    writeFileSync(join(repo, 'shared.ts'), 'ORIGINAL\n')
    writeFileSync(join(worktree, 'own.ts'), 'OWN\n')
    // Looks like a worktree-local file; resolves into the shared checkout.
    symlinkSync(join(repo, 'shared.ts'), join(worktree, 'innocent.ts'))
    // Dangling link to a path that does not exist yet — the new-file case.
    symlinkSync(join(repo, 'notyet.ts'), join(worktree, 'pending.ts'))
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('a symlink out of the worktree is refused', () => {
    expect(
      checkWorktreeEscape(join(worktree, 'innocent.ts'), {
        cwd: worktree,
        sharedCheckout: repo,
      }),
    ).toBeString()
  })

  test('a dangling symlink out of the worktree is refused', () => {
    expect(
      checkWorktreeEscape(join(worktree, 'pending.ts'), {
        cwd: worktree,
        sharedCheckout: repo,
      }),
    ).toBeString()
  })

  test('a real file inside the worktree is still allowed', () => {
    expect(
      checkWorktreeEscape(join(worktree, 'own.ts'), {
        cwd: worktree,
        sharedCheckout: repo,
      }),
    ).toBe(null)
  })

  test('a new file inside the worktree is still allowed', () => {
    expect(
      checkWorktreeEscape(join(worktree, 'brand-new.ts'), {
        cwd: worktree,
        sharedCheckout: repo,
      }),
    ).toBe(null)
  })
})
