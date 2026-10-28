// @ts-nocheck
import * as React from 'react';
import { getIsRemoteMode } from '../../bootstrap/state.js';
import type { LocalJSXCommandContext } from '../../commands.js';
import { ContextVisualization } from '../../components/ContextVisualization.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js';
import { renderToAnsiString } from '../../utils/staticRender.js';
import {
  collectContextData,
  formatContextAsMarkdownTable
} from './context-noninteractive.js';
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext, args: string): Promise<React.ReactNode> {
  const {
    messages,
    getAppState,
    options: {
      mainLoopModel,
      tools,
      agentDefinitions,
      customSystemPrompt,
      appendSystemPrompt,
      mcpClients,
      autoCompactWindow
    }
  } = context;
  const collapseDetailSections = isFullscreenEnvEnabled() && (args ?? '').trim().toLowerCase() !== 'all';

  const apiView = getMessagesAfterCompactBoundary(messages);

  // Get terminal width for responsive sizing
  const terminalWidth = process.stdout.columns || 80;

  // Analyze the same compact-boundary view query.ts sends to the API.
  const data = await collectContextData({
    messages: apiView,
    getAppState,
    options: {
      mainLoopModel,
      tools,
      agentDefinitions,
      customSystemPrompt,
      appendSystemPrompt,
      mcpClients,
      autoCompactWindow
    },
    detail: 'full',
    terminalWidth
  });

  // A remote/bridge session must not surface local memory-file paths.
  const outputData = getIsRemoteMode() ? { ...data, memoryFiles: [] } : data;

  // Render to ANSI string to preserve colors and pass to onDone like local commands do
  const output = await renderToAnsiString(<ContextVisualization data={outputData} collapseDetailSections={collapseDetailSections} />, terminalWidth);
  onDone(output, {
    display: 'system',
    metaMessages: [formatContextAsMarkdownTable(outputData)]
  });
  return null;
}
