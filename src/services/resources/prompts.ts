// @ts-nocheck
import {
  DEFAULT_AGENT_PROMPT,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
} from '../../constants/prompts.js';

export type PromptResource = {
  id: string;
  content: string;
};

export function getPromptResources(): PromptResource[] {
  return [
    {
      id: 'system_prompt_dynamic_boundary',
      content: SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
    },
    {
      id: 'default_agent_prompt',
      content: DEFAULT_AGENT_PROMPT,
    },
  ];
}
