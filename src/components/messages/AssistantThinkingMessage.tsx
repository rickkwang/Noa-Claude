// @ts-nocheck
import type { ThinkingBlock, ThinkingBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React from 'react';
import { Box, Text } from '../../ink.js';
import { Markdown } from '../Markdown.js';
type Props = {
  // Accept either full ThinkingBlock/ThinkingBlockParam or a minimal shape with just type and thinking
  param: ThinkingBlock | ThinkingBlockParam | {
    type: 'thinking';
    thinking: string;
  };
  addMargin: boolean;
};

// ∴ in a two-column gutter, the thinking Markdown beside it. Only rendered in
// transcript/verbose mode — Message.tsx drops thinking blocks otherwise.
export function AssistantThinkingMessage({
  param: {
    thinking
  },
  addMargin = false
}: Props): React.ReactNode {
  const text = thinking?.trim();
  if (!text) {
    return null;
  }
  return <Box flexDirection="row" marginTop={addMargin ? 1 : 0} width="100%">
      <Box minWidth={2}>
        <Text dimColor={true} italic={true}>{"∴"}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Markdown dimColor={true}>{text}</Markdown>
      </Box>
    </Box>;
}
