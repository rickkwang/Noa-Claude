// @ts-nocheck
import { isKairosCronEnabled } from '../../tools/ScheduleCronTool/prompt.js';
import { registerBundledSkill } from '../bundledSkills.js';
import { buildPromptForMode, parseLoopArgs } from './loopHelpers.js';

export function registerLoopSkill(): void {
  registerBundledSkill({
    name: 'loop',
    description:
      'Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo). Omit the interval to let the model self-pace.',
    whenToUse:
      'When the user wants to set up a recurring task, poll for status, or run something repeatedly on an interval (e.g. "check the deploy every 5 minutes", "keep running /babysit-prs"). Do NOT invoke for one-off tasks.',
    argumentHint: '[interval] [prompt]',
    userInvocable: true,
    isEnabled: isKairosCronEnabled,
    async getPromptForCommand(args) {
      const parsed = parseLoopArgs(args);
      const text = buildPromptForMode(parsed);
      return [{ type: 'text', text }];
    },
  });
}
