// @ts-nocheck
import * as React from 'react';
import { Box, Text } from '../ink.js';
import type { ContextData } from '../utils/analyzeContext.js';
import { formatApproxTokens, formatContextOverLimit } from '../utils/analyzeContext.js';
import { generateContextSuggestions } from '../utils/contextSuggestions.js';
import { getDisplayPath } from '../utils/file.js';
import { formatTokens } from '../utils/format.js';
import { getPublicModelDisplayName, parseUserSpecifiedModel } from '../utils/model/model.js';
import { getSourceDisplayName, type SettingSource } from '../utils/settings/constants.js';
import { plural } from '../utils/stringUtils.js';
import { ContextSuggestions } from './ContextSuggestions.js';
const RESERVED_CATEGORY_NAME = 'Autocompact buffer';

// Order for displaying source groups: Project > User > claude.ai sync > Managed > Plugin > MCP > Built-in
const SOURCE_DISPLAY_ORDER = ['Project', 'User', 'claude.ai sync', 'Managed', 'Plugin', 'MCP', 'Built-in'];

/** Group items by source type for display, sorted by tokens descending within each group */
function groupBySource<T extends {
  source: SettingSource | 'plugin' | 'built-in' | 'builtin' | 'bundled' | 'mcp' | 'syncedSkills';
  pluginName?: string;
  tokens: number;
}>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const sourceName = getSourceDisplayName(item.source);
    const key = item.pluginName && item.source !== 'syncedSkills' ? `${sourceName} (${item.pluginName})` : sourceName;
    const existing = groups.get(key) || [];
    existing.push(item);
    groups.set(key, existing);
  }
  // Sort each group by tokens descending
  for (const [key, group] of groups.entries()) {
    groups.set(key, group.sort((a, b) => b.tokens - a.tokens));
  }
  // Return groups in consistent order, including plugin-qualified variants
  const orderedGroups = new Map<string, T[]>();
  for (const source of SOURCE_DISPLAY_ORDER) {
    const group = groups.get(source);
    if (group) {
      orderedGroups.set(source, group);
    }
    const prefixed = [...groups.keys()].filter(key => key.startsWith(source + ' (')).sort();
    for (const key of prefixed) {
      orderedGroups.set(key, groups.get(key)!);
    }
  }
  for (const [key, group] of groups) {
    if (!orderedGroups.has(key)) {
      orderedGroups.set(key, group);
    }
  }
  return orderedGroups;
}
interface Props {
  data: ContextData;
  collapseDetailSections?: boolean;
}
function modelDisplayName(model: string): string | null {
  return getPublicModelDisplayName(parseUserSpecifiedModel(model));
}
function autoCompactWindowLabel(source: string, tokens: string): string {
  if (source === 'experiment' || source === 'clientdata') {
    return `auto (${tokens} tokens)`;
  }
  if (source === 'unknown-model') {
    return `${tokens} tokens (default for an unrecognized model)`;
  }
  return `${tokens} tokens`;
}
function DetailSummary({
  count,
  noun,
  tokens
}: {
  count: number;
  noun: string;
  tokens: number;
}) {
  return <Box><Text dimColor={true}>└ {count} {plural(count, noun)} · {formatTokens(tokens)} tokens</Text></Box>;
}
export function ContextVisualization({
  data,
  collapseDetailSections = false
}: Props) {
  const {
    categories,
    totalTokens,
    rawMaxTokens,
    autocompactSource,
    gridRows,
    model,
    memoryFiles,
    mcpTools,
    agents,
    skills
  } = data;
  const visibleCategories = categories.filter(cat => cat.tokens > 0 && cat.name !== 'Free space' && cat.name !== RESERVED_CATEGORY_NAME && !cat.isDeferred);
  const hasDeferredMcpTools = categories.some(cat => cat.isDeferred && cat.name.includes('MCP'));
  const autocompactCategory = categories.find(cat => cat.name === RESERVED_CATEGORY_NAME);
  const freeSpaceCategory = categories.find(cat => cat.name === 'Free space');
  const overLimit = formatContextOverLimit(data);
  const displayName = modelDisplayName(model);
  const hasDetailSections = mcpTools.length > 0 || agents.length > 0 || memoryFiles.length > 0 || (skills?.tokens ?? 0) > 0;
  const mcpLoadedTokens = mcpTools.filter(tool => !hasDeferredMcpTools || tool.isLoaded).reduce((sum, tool) => sum + tool.tokens, 0);
  return <Box flexDirection="column" paddingLeft={1}>
      <Text bold={true}>Context Usage</Text>
      {overLimit && <Text color="error" wrap="wrap">{overLimit}</Text>}
      <Box flexDirection="row" gap={2}>
        {/* Set a floor: Ink otherwise measures a row narrow enough to wrap
            its trailing whitespace onto a second line, while minWidth lets
            double-width glyphs widen the column. */}
        <Box flexDirection="column" flexShrink={0} minWidth={(gridRows[0]?.length ?? 20) * 2 - 1}>
          {gridRows.map((row, rowIndex) => <Box key={rowIndex} flexDirection="row" marginLeft={-1}>
              {row.map((square, colIndex) => {
            const suffix = colIndex === row.length - 1 ? '' : ' ';
            if (square.categoryName === 'Free space') {
              return <Text key={colIndex} dimColor={true}>{`⛶${suffix}`}</Text>;
            }
            if (square.categoryName === RESERVED_CATEGORY_NAME) {
              return <Text key={colIndex} color={square.color}>{`⛝${suffix}`}</Text>;
            }
            return <Text key={colIndex} color={square.color}>{`${square.squareFullness >= 0.7 ? '⛁' : '⛀'}${suffix}`}</Text>;
          })}
            </Box>)}
        </Box>
        <Box flexDirection="column" gap={0} flexShrink={0}>
          {displayName && <Text>{displayName}</Text>}
          <Text dimColor={true}>{model}</Text>
          <Text dimColor={true}>{formatTokens(totalTokens)}/{formatTokens(rawMaxTokens)} tokens ({data.percentage}%)</Text>
          <Text> </Text>
          <Text dimColor={true} italic={true}>Estimated usage by category</Text>
          {visibleCategories.map((cat, index) => {
          const percentDisplay = cat.isDeferred ? 'N/A' : `${(cat.tokens / rawMaxTokens * 100).toFixed(1)}%`;
          const isReserved = cat.name === RESERVED_CATEGORY_NAME;
          const symbol = cat.isDeferred ? ' ' : isReserved ? '⛝' : '⛁';
          return <Box key={index}>
                <Text color={cat.color}>{symbol}</Text>
                <Text> {cat.name}: </Text>
                <Text dimColor={true}>{formatTokens(cat.tokens)} tokens ({percentDisplay})</Text>
              </Box>;
        })}
          {(freeSpaceCategory?.tokens ?? 0) > 0 && <Box>
              <Text dimColor={true}>⛶</Text>
              <Text> Free space: </Text>
              <Text dimColor={true}>{formatTokens(freeSpaceCategory?.tokens || 0)} ({(freeSpaceCategory!.tokens / rawMaxTokens * 100).toFixed(1)}%)</Text>
            </Box>}
          {autocompactCategory && autocompactCategory.tokens > 0 && <Box>
              <Text color={autocompactCategory.color}>⛝</Text>
              <Text dimColor={true}> {autocompactCategory.name}: </Text>
              <Text dimColor={true}>{formatTokens(autocompactCategory.tokens)} tokens ({(autocompactCategory.tokens / rawMaxTokens * 100).toFixed(1)}%)</Text>
            </Box>}
        </Box>
      </Box>
      {autocompactSource !== 'auto' && <Box marginTop={1}>
          <Text bold={true}>Auto-compact window: </Text>
          <Text dimColor={true}>{autoCompactWindowLabel(autocompactSource, formatTokens(rawMaxTokens))}</Text>
        </Box>}
      <Box flexDirection="column" marginLeft={-1}>
        {mcpTools.length > 0 && <Box flexDirection="column" marginTop={1}>
            <Box>
              <Text bold={true}>MCP tools</Text>
              <Text dimColor={true}> · /mcp{hasDeferredMcpTools ? ' (loaded on-demand)' : ''}</Text>
            </Box>
            {collapseDetailSections ? <DetailSummary count={mcpTools.length} noun="tool" tokens={mcpLoadedTokens} /> : <>
                {mcpTools.some(tool => tool.isLoaded) && <Box flexDirection="column" marginTop={1}>
                    <Text dimColor={true}>Loaded</Text>
                    {mcpTools.filter(tool => tool.isLoaded).map((tool, index) => <Box key={index}><Text>└ {tool.name}: </Text><Text dimColor={true}>{formatTokens(tool.tokens)} tokens</Text></Box>)}
                  </Box>}
                {hasDeferredMcpTools && mcpTools.some(tool => !tool.isLoaded) && <Box flexDirection="column" marginTop={1}>
                    <Text dimColor={true}>Available</Text>
                    {mcpTools.filter(tool => !tool.isLoaded).map((tool, index) => <Box key={index}><Text dimColor={true}>└ {tool.name}</Text></Box>)}
                  </Box>}
                {!hasDeferredMcpTools && mcpTools.map((tool, index) => <Box key={index}><Text>└ {tool.name}: </Text><Text dimColor={true}>{formatTokens(tool.tokens)} tokens</Text></Box>)}
              </>}
          </Box>}
        {agents.length > 0 && <Box flexDirection="column" marginTop={1}>
            <Box>
              <Text bold={true}>Custom agents</Text>
              <Text dimColor={true}> · .claude/agents/</Text>
            </Box>
            {collapseDetailSections ? <DetailSummary count={agents.length} noun="agent" tokens={agents.reduce((sum, agent) => sum + agent.tokens, 0)} /> : Array.from(groupBySource(agents).entries()).map(([sourceDisplay, sourceAgents]) => <Box key={sourceDisplay} flexDirection="column" marginTop={1}>
                <Text dimColor={true}>{sourceDisplay}</Text>
                {sourceAgents.map((agent, index) => <Box key={index}><Text>└ {agent.agentType}: </Text><Text dimColor={true}>{formatTokens(agent.tokens)} tokens</Text></Box>)}
              </Box>)}
          </Box>}
        {memoryFiles.length > 0 && <Box flexDirection="column" marginTop={1}>
            <Box>
              <Text bold={true}>Memory files</Text>
              <Text dimColor={true}> · /memory</Text>
            </Box>
            {collapseDetailSections ? <DetailSummary count={memoryFiles.length} noun="file" tokens={memoryFiles.reduce((sum, file) => sum + file.tokens, 0)} /> : memoryFiles.map((file, index) => <Box key={index}>
                <Text>└ {getDisplayPath(file.path)}: </Text>
                <Text dimColor={true}>{formatTokens(file.tokens)} tokens</Text>
              </Box>)}
          </Box>}
        {skills && skills.tokens > 0 && <Box flexDirection="column" marginTop={1}>
            <Box>
              <Text bold={true}>Skills</Text>
              <Text dimColor={true}> · /skills</Text>
            </Box>
            {collapseDetailSections ? <DetailSummary count={skills.skillFrontmatter.length} noun="skill" tokens={skills.tokens} /> : Array.from(groupBySource(skills.skillFrontmatter).entries()).map(([sourceDisplay, sourceSkills]) => <Box key={sourceDisplay} flexDirection="column" marginTop={1}>
                <Text dimColor={true}>{sourceDisplay}</Text>
                {sourceSkills.map((skill, index) => <Box key={index}><Text>└ {skill.name}: </Text><Text dimColor={true}>{formatApproxTokens(skill.tokens)} tokens</Text></Box>)}
              </Box>)}
          </Box>}
        {collapseDetailSections && hasDetailSections && <Box marginTop={1}>
            <Text dimColor={true}>/context all to expand</Text>
          </Box>}
      </Box>
      <ContextSuggestions suggestions={generateContextSuggestions(data)} />
    </Box>;
}
