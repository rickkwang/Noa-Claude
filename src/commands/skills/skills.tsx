// @ts-nocheck
import * as React from 'react';
import type { LocalJSXCommandContext } from '../../commands.js';
import { SkillsMenu } from '../../components/skills/SkillsMenu.js';
import { bytesPerTokenForModel } from '../../services/tokenEstimation.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  return <SkillsMenu onExit={onDone} commands={context.options.commands} bytesPerToken={bytesPerTokenForModel(context.options.mainLoopModel)} />;
}
