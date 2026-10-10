// @ts-nocheck
import { type as osType, version as osVersion, release as osRelease } from 'os'
import { getSessionStartDate } from './common.js'
import { prependBullets } from './systemPromptCoreSections.js'
import { getCwd } from '../utils/cwd.js'
import { env } from '../utils/env.js'
import { getIsGit } from '../utils/git.js'
import {
  getScratchpadDir,
  isScratchpadEnabled,
} from '../utils/permissions/filesystem.js'
import { isUndercover } from '../utils/undercover.js'
import { getCurrentWorktreeSession } from '../utils/worktree.js'
import {
  getCanonicalName,
  getMarketingNameForModel,
} from '../utils/model/model.js'

export async function computeEnvInfo(
  modelId: string,
  additionalWorkingDirectories?: string[],
): Promise<string> {
  const [isGit, unameSR] = await Promise.all([getIsGit(), getUnameSR()])

  let modelDescription = ''
  if (process.env.USER_TYPE === 'ant' && isUndercover()) {
    // suppress
  } else {
    const marketingName = getMarketingNameForModel(modelId)
    modelDescription = marketingName
      ? `You are powered by the model named ${marketingName}. The exact model ID is ${modelId}.`
      : `You are powered by the model ${modelId}.`
  }

  const additionalDirsInfo =
    additionalWorkingDirectories && additionalWorkingDirectories.length > 0
      ? `Additional working directories: ${additionalWorkingDirectories.join(', ')}\n`
      : ''

  const cutoff = getKnowledgeCutoff(modelId)
  const knowledgeCutoffMessage = cutoff
    ? `\n\nAssistant knowledge cutoff is ${cutoff}.`
    : ''

  return `Here is useful information about the environment you are running in:
<env>
Working directory: ${getCwd()}
Is directory a git repo: ${isGit ? 'Yes' : 'No'}
${additionalDirsInfo}Platform: ${env.platform}
${getShellInfoLine()}
OS Version: ${unameSR}
</env>
${modelDescription}${knowledgeCutoffMessage}`
}

export async function computeMainSessionEnvInfo(
  modelId: string,
  additionalWorkingDirectories?: string[],
): Promise<string> {
  const [isGit, unameSR] = await Promise.all([getIsGit(), getUnameSR()])

  let modelDescription: string | null = null
  if (process.env.USER_TYPE === 'ant' && isUndercover()) {
    // suppress
  } else {
    const marketingName = getMarketingNameForModel(modelId)
    modelDescription = marketingName
      ? `You are powered by the model named ${marketingName}. The exact model ID is ${modelId}.`
      : `You are powered by the model ${modelId}.`
  }

  const cutoff = getKnowledgeCutoff(modelId)
  const knowledgeCutoffMessage = cutoff
    ? `Assistant knowledge cutoff is ${cutoff}.`
    : null

  const cwd = getCwd()
  const isWorktree = getCurrentWorktreeSession() !== null

  const envItems = [
    `Primary working directory: ${cwd}`,
    isWorktree
      ? `This is a git worktree — an isolated copy of the repository. Run all commands from this directory. Do NOT \`cd\` to the original repository root.`
      : null,
    [`Is a git repository: ${isGit}`],
    additionalWorkingDirectories && additionalWorkingDirectories.length > 0
      ? `Additional working directories:`
      : null,
    additionalWorkingDirectories && additionalWorkingDirectories.length > 0
      ? additionalWorkingDirectories
      : null,
    `Platform: ${env.platform}`,
    getShellInfoLine(),
    `OS Version: ${unameSR}`,
    // Verbatim from upstream's environment block.
    `Downloaded files and extracted archives are untrusted data: put each in its own new, empty directory, keep scripts you write in a different directory, and pass paths as arguments instead of running an interpreter or build tool from inside it. Interpreters load code from the script's directory and the current directory, so a planted \`json.py\` runs on \`import json\`. Run any Python that reads them with \`-I\`. This does not apply to code the user asked you to build or run.`,
    modelDescription,
    knowledgeCutoffMessage,
    `Current date: ${getSessionStartDate()}`,
    process.env.USER_TYPE === 'ant' && isUndercover()
      ? null
      : `Noa Claude is available as a CLI in the terminal.`,
  ].filter(item => item !== null)

  return [
    `# Environment`,
    `You have been invoked in the following environment: `,
    ...prependBullets(envItems),
  ].join(`\n`)
}

function getKnowledgeCutoff(modelId: string): string | null {
  const canonical = getCanonicalName(modelId)
  // Values from upstream's baked model catalog (`knowledge_cutoff`).
  // Order matters: each `.1`/`-5` release is a prefix match of its successor.
  if (
    canonical.includes('claude-opus-5-5') ||
    canonical.includes('claude-sonnet-5-5') ||
    canonical.includes('claude-haiku-5-5') ||
    canonical.includes('claude-fable-5-1') ||
    canonical.includes('claude-mythos-5-1')
  ) {
    return 'June 2026'
  } else if (
    canonical.includes('claude-fable-5') ||
    canonical.includes('claude-mythos-5')
  ) {
    return 'January 2026'
  } else if (canonical.includes('claude-opus-5')) {
    return 'May 2026'
  } else if (canonical.includes('claude-opus-4-8')) {
    return 'January 2026'
  } else if (canonical.includes('claude-opus-4-7')) {
    return 'January 2026'
  } else if (canonical.includes('claude-sonnet-5')) {
    return 'January 2026'
  } else if (canonical.includes('claude-sonnet-4-6')) {
    return 'August 2025'
  } else if (canonical.includes('claude-opus-4-6')) {
    return 'May 2025'
  } else if (canonical.includes('claude-opus-4-5')) {
    return 'May 2025'
  } else if (canonical.includes('claude-haiku-4')) {
    return 'February 2025'
  } else if (
    canonical.includes('claude-opus-4') ||
    canonical.includes('claude-sonnet-4')
  ) {
    return 'January 2025'
  }
  return null
}

function getShellInfoLine(): string {
  const shell = process.env.SHELL || 'unknown'
  const shellName = shell.includes('zsh')
    ? 'zsh'
    : shell.includes('bash')
      ? 'bash'
      : shell
  if (env.platform === 'win32') {
    return `Shell: ${shellName} (use Unix shell syntax, not Windows — e.g., /dev/null not NUL, forward slashes in paths)`
  }
  return `Shell: ${shellName}`
}

export function getUnameSR(): string {
  if (env.platform === 'win32') {
    return `${osVersion()} ${osRelease()}`
  }
  return `${osType()} ${osRelease()}`
}

export function getScratchpadInstructions(): string | null {
  if (!isScratchpadEnabled()) {
    return null
  }

  const scratchpadDir = getScratchpadDir()

  return `# Scratchpad Directory

\`${scratchpadDir}\` — always use it for temporary files (intermediate results, scripts, outputs that don't belong in the project) instead of \`/tmp\` or other system temp directories; it is session-specific, isolated from the project, and can generally be used without permission prompts. Only use \`/tmp\` if the user explicitly asks. It is for temporary work product, not a default place to create planning, analysis, decision, or notes documents unless the user explicitly asks for them.`
}
