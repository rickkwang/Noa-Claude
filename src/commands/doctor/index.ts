// @ts-nocheck
import type { Command } from '../../commands.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { DOCTOR_PROMPT } from './doctorPrompt.js'

// `/doctor` (alias `/checkup`) is an agentic health check: it drives the model
// through a fixed set of read-only checks (installation health, unused
// skills/MCP servers/plugins, bloated or duplicated memory files, slow hooks,
// context-heavy extensions, version, permission-mode + allowlist tuning) and
// then proposes fixes gated behind confirmation.
//
// The read-only installation-diagnostics *screen* (Doctor.tsx) still ships as
// the terminal `noa doctor` subcommand; Check 0 of this prompt replicates its
// findings and turns each into an actionable fix.
const doctor: Command = {
  type: 'prompt',
  name: 'doctor',
  aliases: ['checkup'],
  description:
    'Health-check your Noa Claude setup and fix issues: installation, unused extensions, duplicated or bloated memory files, slow hooks, version, permissions',
  isEnabled: () => !isEnvTruthy(process.env.DISABLE_DOCTOR_COMMAND),
  // User-invocable only — this runs a wide read-only scan and proposes edits,
  // so it should be triggered deliberately, never auto-dispatched by the model.
  disableModelInvocation: true,
  userInvocable: true,
  contentLength: DOCTOR_PROMPT.length,
  progressMessage: 'running checkup',
  source: 'builtin',
  argumentHint: '[optional extra instructions]',
  async getPromptForCommand(args: string) {
    let text = DOCTOR_PROMPT
    if (args?.trim()) {
      text += `\n\n## Additional instructions from the user\n\n${args.trim()}`
    }
    return [{ type: 'text', text }]
  },
}

export default doctor
