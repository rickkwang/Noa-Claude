// @ts-nocheck
import { isKairosCronEnabled } from '../../tools/ScheduleCronTool/prompt.js';
import { registerBundledSkill } from '../bundledSkills.js';
import { buildPromptForMode, parseLoopArgs } from './loopHelpers.js';

export function registerLoopSkill(): void {
  registerBundledSkill({
    name: 'loop',
    description:
      'Run a prompt on a fixed interval or dynamically reschedule it, including bare maintenance-mode loops.',
    whenToUse:
      'When the user wants to poll for status, babysit a workflow, run recurring maintenance, or keep re-running a prompt within the current session.',
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
