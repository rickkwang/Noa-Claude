import * as React from 'react';
import type { CommandResultDisplay, LocalJSXCommandContext } from '../../commands.js';
import { Select } from '../../components/CustomSelect/select.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { Box, Link, Text } from '../../ink.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { AppState } from '../../state/AppStateStore.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { isAdvisorEnabled, modelSupportsAdvisor } from '../../utils/advisor.js';
import { withCacheSwitchNotice } from '../../utils/cacheSwitchNotice.js';
import { getMainLoopModel, renderModelName } from '../../utils/model/model.js';
import { getAdvisorAliases, resolveAdvisorModel, setAdvisor } from './setAdvisor.js';

const ADVISOR_STRATEGY_URL = 'https://claude.com/blog/the-advisor-strategy';

type OnDone = (result?: string, options?: { display?: CommandResultDisplay }) => void;

function withNoticeIfChanged({ message, changed }: { message: string; changed: boolean }): string {
  return changed ? withCacheSwitchNotice(message) : message;
}

function AdvisorPicker({ onDone }: { onDone: OnDone }): React.ReactNode {
  const current = useAppState((s: AppState) => s.advisorModel) as string | undefined;
  const setAppState = useSetAppState();
  const mainLoopModel = useMainLoopModel();
  const aliases = getAdvisorAliases();
  const currentLower = current?.toLowerCase();
  const currentAlias = currentLower ? aliases.find(alias => currentLower.includes(alias)) : undefined;
  const custom = current && !currentAlias ? current : undefined;
  const options = [
    ...aliases.map(alias => ({ label: renderModelName(resolveAdvisorModel(alias)), value: alias })),
    ...(custom ? [{ label: renderModelName(resolveAdvisorModel(custom)), value: custom }] : []),
    { label: 'No advisor', value: 'off' },
  ];
  const selected = custom ?? currentAlias ?? 'off';
  const cancel = () => onDone(undefined, { display: 'skip' });
  return (
    <Dialog title="Advisor (experimental)" onCancel={cancel}>
      <Box flexDirection="column" gap={1}>
        <Text>
          When Claude needs stronger judgment — a complex decision, an ambiguous failure, a problem it's circling
          without progress — it escalates to the advisor model for guidance, then resumes. The advisor runs
          server-side and uses additional tokens.
        </Text>
        {!modelSupportsAdvisor(mainLoopModel) && (
          <Text color="warning">The current main model ({renderModelName(mainLoopModel)}) does not support the advisor.</Text>
        )}
        <Select
          options={options}
          defaultValue={selected}
          defaultFocusValue={selected}
          onChange={(choice: string) => onDone(withNoticeIfChanged(setAdvisor(choice, current, mainLoopModel, setAppState)))}
          onCancel={cancel}
        />
        <Text>
          <Text color="suggestion">Recommended setup: </Text>
          Sonnet as the main model with Opus as the advisor. For certain workloads this gives near-Opus performance
          with reduced token usage.
        </Text>
        <Link url={ADVISOR_STRATEGY_URL} />
      </Box>
    </Dialog>
  );
}

export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext, args?: string): Promise<React.ReactNode> {
  if (!isAdvisorEnabled()) {
    onDone('The advisor is not available');
    return null;
  }
  const arg = args?.trim().toLowerCase() ?? '';
  if (!arg) {
    return <AdvisorPicker onDone={onDone} />;
  }
  const choice = arg === 'unset' ? 'off' : arg;
  const previous = context.getAppState().advisorModel;
  onDone(withNoticeIfChanged(setAdvisor(choice, previous, getMainLoopModel(), context.setAppState)));
  return null;
}
