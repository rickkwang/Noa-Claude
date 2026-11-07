// @ts-nocheck
import { getAutoMemPath, isAutoMemoryEnabled } from '../../memdir/paths.js'
import { buildConsolidationPrompt } from '../../services/autoDream/consolidationPrompt.js'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { isTeamMemoryEnabled } from '../../memdir/teamMemPaths.js'
import { getProjectDir } from '../../utils/sessionStorage.js'
import { registerBundledSkill } from '../bundledSkills.js'

export function registerDreamSkill(): void {
  registerBundledSkill({
    name: 'dream',
    description:
      'Run memory consolidation — a reflective pass over your memory files to synthesize recent learning into durable, well-organized memories.',
    whenToUse:
      'Use when the user wants to trigger an immediate memory consolidation. Also useful after a significant session or at the start of a new project to orient.',
    userInvocable: true,
    isEnabled: () => isAutoMemoryEnabled(),
    context: 'fork',
    async getPromptForCommand(args) {
      // Mtime stamping happens in executeForkedSlashCommand after the agent
      // completes successfully, not here. Stamping at prompt-build time
      // mis-locks auto-dream for 24h when the user ESCs immediately.
      return [
        {
          type: 'text',
          text: buildConsolidationPrompt(
            getAutoMemPath(),
            getProjectDir(getOriginalCwd()),
            args ?? '',
            isTeamMemoryEnabled(),
          ),
        },
      ]
    },
  })
}
