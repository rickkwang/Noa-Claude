// @ts-nocheck
import memoize from 'lodash-es/memoize.js'
import { existsSync } from 'fs'
import { join } from 'path'
import { getCwd } from './utils/cwd.js'
import { isDirEmpty } from './utils/file.js'

export type Step = {
  key: string
  text: string
  isComplete: boolean
  isCompletable: boolean
  isEnabled: boolean
}

export function getSteps(): Step[] {
  const cwd = getCwd()
  // Only check current dir — onboarding is per-project, and /init creates
  // the instruction file in cwd, not in a parent. Recursing upward causes
  // false positives when a parent has CLAUDE.md/AGENTS.md.
  const hasProjectInstructions =
    existsSync(join(cwd, 'AGENTS.md')) || existsSync(join(cwd, 'CLAUDE.md'))
  const isWorkspaceDirEmpty = isDirEmpty(cwd)

  return [
    {
      key: 'workspace',
      text: 'Ask Claude to create a new app or clone a repository',
      isComplete: false,
      isCompletable: true,
      isEnabled: isWorkspaceDirEmpty,
    },
    {
      key: 'claudemd',
      text: 'Run /init to create AGENTS.md or CLAUDE.md instructions for Claude',
      isComplete: hasProjectInstructions,
      isCompletable: true,
      isEnabled: !isWorkspaceDirEmpty,
    },
  ]
}

export function isProjectOnboardingComplete(): boolean {
  return getSteps()
    .filter(({ isCompletable, isEnabled }) => isCompletable && isEnabled)
    .every(({ isComplete }) => isComplete)
}

export const shouldShowProjectOnboarding = memoize((): boolean => {
  if (process.env.IS_DEMO) return false
  return !isProjectOnboardingComplete()
})
