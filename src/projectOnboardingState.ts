// @ts-nocheck
import { existsSync } from 'fs'
import { getCwd } from './utils/cwd.js'
import { isDirEmpty } from './utils/file.js'
import { getProjectMemoryFileCandidates } from './utils/productPaths.js'

export type Step = {
  key: string
  text: string
  isComplete: boolean
  isCompletable: boolean
  isEnabled: boolean
}

export function getSteps(): Step[] {
  const cwd = getCwd()
  // Only check current dir — onboarding is per-project. Recursing upward causes
  // false positives when a parent has project instructions.
  const hasProjectInstructions = getProjectMemoryFileCandidates(cwd).some(path =>
    existsSync(path),
  )
  const isWorkspaceDirEmpty = isDirEmpty(cwd)

  return [
    {
      key: 'workspace',
      text: 'Ask Noa Claude to create a new app or clone a repository',
      isComplete: false,
      isCompletable: true,
      isEnabled: isWorkspaceDirEmpty,
    },
    {
      key: 'claudemd',
      text: 'Run /init to create AGENTS.md or fallback CLAUDE.md instructions for Noa Claude',
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

export function shouldShowProjectOnboarding(): boolean {
  if (process.env.IS_DEMO) return false
  return !isProjectOnboardingComplete()
}
