import * as React from 'react';
import { Suspense, useState } from 'react';
import { useIsInsideModal, useModalOrTerminalSize } from '../../context/modalContext.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import type { ExitState } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import type { CommandResultDisplay, LocalJSXCommandContext } from '../../commands.js';
import { Dialog } from '../design-system/Dialog.js';
import { Tab, Tabs } from '../design-system/Tabs.js';
import { Status, buildDiagnostics } from './Status.js';
import { Config } from './Config.js';
import { Usage } from './Usage.js';
import { Stats } from '../Stats.js';

type Props = {
  onClose: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  context: LocalJSXCommandContext;
  defaultTab: 'Status' | 'Config' | 'Usage' | 'Stats';
};

export function UsageDashboard({
  onClose,
  context,
  defaultTab,
}: Props): React.ReactNode {
  const [selectedTab, setSelectedTab] = useState(defaultTab);
  const [tabsHidden, setTabsHidden] = useState(false);
  const [configOwnsEsc, setConfigOwnsEsc] = useState(false);
  const insideModal = useIsInsideModal();
  const { rows } = useModalOrTerminalSize(useTerminalSize());
  const contentHeight = insideModal ? rows + 1 : Math.max(15, Math.min(Math.floor(rows * 0.8), 30));
  const [diagnosticsPromise] = useState(() => buildDiagnostics().catch(() => []));
  const isStatsTab = selectedTab === 'Stats';

  const handleEscape = React.useCallback(() => {
    if (tabsHidden) {
      return;
    }
    onClose('Usage dialog dismissed', { display: 'system' });
  }, [onClose, tabsHidden]);

  return (
    <Dialog
      title={isStatsTab ? 'Stats' : 'Settings'}
      subtitle={isStatsTab ? 'Usage, configuration, diagnostics, and model activity' : 'Status, configuration, usage, and model activity'}
      color="permission"
      onCancel={handleEscape}
      isCancelActive={!tabsHidden && !(selectedTab === 'Config' && configOwnsEsc)}
      inputGuide={(exitState: ExitState) =>
        exitState.pending
          ? `Press ${exitState.keyName} again to exit`
          : '←/→ to switch tabs, Esc to close'
      }
    >
      <Tabs
        title=""
        color="permission"
        selectedTab={selectedTab}
        onTabChange={setSelectedTab}
        hidden={tabsHidden}
        initialHeaderFocused={defaultTab !== 'Config'}
        contentHeight={tabsHidden || insideModal ? undefined : contentHeight}
      >
        <Tab key="status" title="Status">
          <Status context={context} diagnosticsPromise={diagnosticsPromise} />
        </Tab>
        <Tab key="config" title="Config">
          <Suspense fallback={null}>
            <Config
              context={context}
              onClose={onClose}
              setTabsHidden={setTabsHidden}
              onIsSearchModeChange={setConfigOwnsEsc}
              contentHeight={contentHeight}
            />
          </Suspense>
        </Tab>
        <Tab key="usage" title="Usage">
          <Usage />
        </Tab>
        <Tab key="stats" title="Stats">
          <Stats onClose={onClose} embedded={true} />
        </Tab>
      </Tabs>
    </Dialog>
  );
}
