// @ts-nocheck
import memoize from 'lodash-es/memoize.js';
import {
  activateConditionalSkillsForPaths,
  clearDynamicSkills,
  clearSkillCaches as clearSkillCachesLegacy,
  getConditionalSkillCount,
  getDynamicSkills as getDynamicSkillsLegacy,
  getSkillDirCommands as getSkillDirCommandsLegacy,
  onDynamicSkillsLoaded,
} from '../../skills/loadSkillsDir.js';
import type { Command } from '../../types/command.js';

function normalizeCommands(commands: Command[]): Command[] {
  return commands.filter(Boolean);
}

export const getSkillDirCommands = memoize(
  async (cwd: string): Promise<Command[]> => {
    const commands = await getSkillDirCommandsLegacy(cwd);
    return normalizeCommands(commands);
  },
);

export function getDynamicSkills(): Command[] {
  return normalizeCommands(getDynamicSkillsLegacy());
}

export const getSkillResourceSnapshot = memoize(
  async (cwd: string): Promise<{
    discoveredSkills: Command[];
    dynamicSkills: Command[];
    mergedSkills: Command[];
  }> => {
    const discoveredSkills = await getSkillDirCommands(cwd);
    const dynamicSkills = getDynamicSkills();

    return {
      discoveredSkills,
      dynamicSkills,
      mergedSkills: normalizeCommands([...discoveredSkills, ...dynamicSkills]),
    };
  },
);

export function clearSkillResourceCaches(): void {
  getSkillDirCommands.cache?.clear?.();
  getSkillResourceSnapshot.cache?.clear?.();
  clearSkillCachesLegacy();
}

export {
  activateConditionalSkillsForPaths,
  clearDynamicSkills,
  getConditionalSkillCount,
  onDynamicSkillsLoaded,
};
