import * as React from 'react';
import { useEffect, useState } from 'react';
import { getProjectRoot, getSdkBetas } from '../../bootstrap/state.js';
import { type Command, getCommandName, getMcpSkillCommands, getSkillToolCommands } from '../../commands.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { useAppStateStore } from '../../state/AppState.js';
import { roughTokenCountEstimation } from '../../services/tokenEstimation.js';
import { formatCommandsWithinBudget } from '../../tools/SkillTool/prompt.js';
import { plural } from '../../utils/stringUtils.js';
import { getGlobalConfig } from '../../utils/config.js';
import { getContextWindowForModel } from '../../utils/context.js';
import { errorMessage } from '../../utils/errors.js';
import { formatTokens } from '../../utils/format.js';

type Owner = 'settings' | 'plugin' | 'mcp';

type SkillStatsRow = {
  name: string;
  source: string;
  owner: Owner;
  pluginKey?: string;
  usageCount: number;
  daysSinceUse: number | null;
  listingTokens: number | null;
};

type SkillStatsReport = {
  rows: SkillStatsRow[];
  unusedOwned: SkillStatsRow[];
  unusedFromPlugins: SkillStatsRow[];
  unusedFromMcp: SkillStatsRow[];
  unusedMcpServers: string[];
};

export type SkillStatsInputs = {
  commands: readonly Command[];
  mainLoopModel: string;
};

// Tokens each skill's one-line entry costs in the skill listing, keyed by
// name. Skills that are not in the listing get no entry.
async function getListingTokens(inputs: SkillStatsInputs, mcpCommands: readonly Command[]): Promise<Map<string, number>> {
  const local = await getSkillToolCommands(getProjectRoot());
  const seen = new Set<string>();
  const listed = [...local, ...getMcpSkillCommands(mcpCommands)].filter(cmd => !seen.has(cmd.name) && seen.add(cmd.name));
  const contextWindowTokens = getContextWindowForModel(inputs.mainLoopModel, getSdkBetas());
  const lines = formatCommandsWithinBudget(listed, contextWindowTokens).split(/\n(?=- )/);
  const tokens = new Map<string, number>();
  listed.forEach((cmd, i) => {
    const line = lines.length === listed.length ? lines[i]! : formatCommandsWithinBudget([cmd], contextWindowTokens);
    tokens.set(cmd.name, roughTokenCountEstimation(line));
  });
  return tokens;
}

async function computeSkillStats(inputs: SkillStatsInputs, mcpCommands: readonly Command[]): Promise<SkillStatsReport> {
  const listingTokens = await getListingTokens(inputs, mcpCommands);
  const usage = getGlobalConfig().skillUsage ?? {};
  // Usage is recorded under whatever name the skill was invoked by (its name,
  // display name, alias, or a plugin skill's bare suffix). Fall back to those
  // only when no other loaded command claims the same key.
  const claims = new Map<string, number>();
  const claim = (key: string) => claims.set(key, (claims.get(key) ?? 0) + 1);
  for (const cmd of inputs.commands) {
    const i = cmd.name.lastIndexOf(':');
    new Set([cmd.name, getCommandName(cmd), ...(cmd.aliases ?? []), ...(i > 0 ? [cmd.name.slice(i + 1)] : [])]).forEach(claim);
  }
  const usageFor = (cmd: Command) => {
    if (usage[cmd.name]) return usage[cmd.name];
    const i = cmd.name.lastIndexOf(':');
    const fallbacks = [getCommandName(cmd), ...(cmd.aliases ?? []), ...(i > 0 ? [cmd.name.slice(i + 1)] : [])];
    const key = fallbacks.find(k => k !== cmd.name && claims.get(k) === 1 && usage[k]);
    return key === undefined ? undefined : usage[key];
  };
  const rows: SkillStatsRow[] = [];
  for (const cmd of inputs.commands) {
    if (cmd.type !== 'prompt') continue;
    if (cmd.source === 'bundled' || cmd.source === 'builtin' || cmd.source === 'policySettings') continue;
    if (cmd.source === 'mcp' && cmd.loadedFrom !== 'mcp') continue;
    const used = usageFor(cmd);
    rows.push({
      name: cmd.name,
      source: cmd.pluginInfo ? cmd.pluginInfo.pluginManifest.name : cmd.source,
      owner: cmd.source === 'plugin' ? 'plugin' : cmd.source === 'mcp' ? 'mcp' : 'settings',
      pluginKey: cmd.pluginInfo?.pluginManifest.name,
      usageCount: used?.usageCount ?? 0,
      daysSinceUse: used ? Math.floor((Date.now() - used.lastUsedAt) / 86_400_000) : null,
      listingTokens: listingTokens.get(cmd.name) ?? null
    });
  }
  rows.sort((a, b) => (b.daysSinceUse ?? Infinity) - (a.daysSinceUse ?? Infinity));
  // Only skills that cost listing tokens yet were never invoked are worth flagging.
  const unused = rows.filter(r => r.usageCount === 0 && r.listingTokens !== null);
  const usedPlugins = new Set(rows.filter(r => r.usageCount > 0 && r.pluginKey !== undefined).map(r => r.pluginKey));
  const serverOf = (r: SkillStatsRow) => {
    const i = r.name.indexOf(':');
    return i > 0 ? r.name.slice(0, i) : undefined;
  };
  const usedServers = new Set(rows.filter(r => r.owner === 'mcp' && r.usageCount > 0).map(serverOf));
  const unusedFromMcp = unused.filter(r => r.owner === 'mcp' && !usedServers.has(serverOf(r)));
  return {
    rows,
    unusedOwned: unused.filter(r => r.owner === 'settings'),
    unusedFromPlugins: unused.filter(r => r.owner === 'plugin' && !usedPlugins.has(r.pluginKey)),
    unusedFromMcp,
    unusedMcpServers: [...new Set(unusedFromMcp.map(serverOf).filter((s): s is string => s !== undefined))]
  };
}

const padEnd = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - stringWidth(s)));
const padStart = (s: string, w: number) => ' '.repeat(Math.max(0, w - stringWidth(s))) + s;

function formatListingTokens(n: number): string {
  return n < 20 ? '< 20' : `~${formatTokens(Math.round(n / 10) * 10)}`;
}

function SkillTable({ rows }: { rows: SkillStatsRow[] }): React.ReactNode {
  if (rows.length === 0) return <Text dimColor>  (no skills loaded)</Text>;
  const cells = rows.map(r => ({
    context: r.listingTokens === null ? '-' : formatListingTokens(r.listingTokens),
    lastUsed: r.daysSinceUse === null ? 'never' : r.daysSinceUse === 0 ? 'today' : `${r.daysSinceUse} ${plural(r.daysSinceUse, 'day')}`
  }));
  const w = {
    name: Math.max(5, ...rows.map(r => stringWidth(r.name))),
    source: Math.max(6, ...rows.map(r => stringWidth(r.source))),
    context: Math.max(7, ...cells.map(c => stringWidth(c.context))),
    uses: Math.max(4, ...rows.map(r => String(r.usageCount).length))
  };
  return <Box flexDirection="column">
      <Text dimColor>{`  ${padEnd('skill', w.name)}  ${padEnd('source', w.source)}  ${padStart('context', w.context)}  ${padStart('uses', w.uses + 1)}  last used`}</Text>
      {rows.map((r, i) => <Text key={`${i}:${r.name}`} color={r.usageCount === 0 ? 'warning' : undefined}>
          {`  ${padEnd(r.name, w.name)}  `}
          <Text dimColor>{padEnd(r.source, w.source)}</Text>
          {`  ${padStart(cells[i]!.context, w.context)}  ${padStart(String(r.usageCount), w.uses)}×  ${cells[i]!.lastUsed}`}
        </Text>)}
    </Box>;
}

function UnusedWarnings({ report }: { report: SkillStatsReport }): React.ReactNode {
  const { rows, unusedOwned, unusedFromPlugins, unusedFromMcp, unusedMcpServers } = report;
  if (rows.length === 0) return null;
  const plugins = [...new Set(unusedFromPlugins.map(r => r.pluginKey ?? r.source))];
  const one = unusedMcpServers.length <= 1;
  return <Box flexDirection="column" marginTop={1}>
      {unusedOwned.length > 0 && <Text color="warning" wrap="wrap">{`${unusedOwned.length} ${plural(unusedOwned.length, 'skill')} loaded but never invoked. Each one adds to the system prompt every turn. Disable in /skills, or remove from .noa/skills.`}</Text>}
      {unusedFromPlugins.length > 0 && <Text color="warning" wrap="wrap">{`${unusedFromPlugins.length} plugin ${plural(unusedFromPlugins.length, 'skill')} loaded but never invoked, from ${plugins.join(', ')}. Each one adds to the system prompt every turn. Plugin skills can't be turned off individually — disable ${plugins.length === 1 ? 'the plugin' : 'those plugins'} in the Installed tab.`}</Text>}
      {unusedFromMcp.length > 0 && <Text color="warning" wrap="wrap">{`${unusedFromMcp.length} MCP ${plural(unusedFromMcp.length, 'skill')} loaded but never invoked${unusedMcpServers.length > 0 ? `, from ${unusedMcpServers.join(', ')}` : ''}. Each one adds to the system prompt every turn. MCP skills live on the server, not on disk — turning ${one ? 'that server' : 'those servers'} off in /mcp also removes ${one ? 'its' : 'their'} tools.`}</Text>}
      {rows.every(r => r.usageCount > 0) && <Text color="success">All loaded skills have been used at least once.</Text>}
    </Box>;
}

export function SkillStats({ inputs, onExit }: { inputs: SkillStatsInputs; onExit: () => void }): React.ReactNode {
  const [state, setState] = useState<{ report: SkillStatsReport } | { error: string } | null>(null);
  const appStateStore = useAppStateStore();
  useEffect(() => {
    let live = true;
    computeSkillStats(inputs, appStateStore.getState().mcp.commands).then(report => live && setState({ report }), (e: unknown) => live && setState({ error: errorMessage(e) }));
    return () => {
      live = false;
    };
  }, [inputs, appStateStore]);
  useKeybinding('confirm:no', onExit, { context: 'Confirmation' });
  const title = <Text bold>Skills loaded this session</Text>;
  if (state === null) {
    return <Box flexDirection="column">{title}<Box marginTop={1}><Text dimColor>Computing skill usage{'…'}</Text></Box></Box>;
  }
  if ('error' in state) {
    return <Text dimColor wrap="wrap">Couldn't compute skill usage. Run with --debug for details. ({state.error})</Text>;
  }
  const { rows } = state.report;
  return <Box flexDirection="column">
      {title}
      <Box flexDirection="column" marginTop={1}><SkillTable rows={rows} /></Box>
      {rows.length > 0 && <Box flexDirection="column" marginTop={1}>
          <Text dimColor wrap="wrap">  context = this skill's one-line listing in the system prompt, included every turn</Text>
          <Text dimColor wrap="wrap">  (dash = not in the current listing, costs nothing; full SKILL.md loads only when it runs)</Text>
        </Box>}
      <UnusedWarnings report={state.report} />
    </Box>;
}
