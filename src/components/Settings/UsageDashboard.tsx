import * as React from 'react';
import { Suspense, useState } from 'react';
import { useIsInsideModal, useModalOrTerminalSize } from '../../context/modalContext.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import type { CommandResultDisplay, LocalJSXCommandContext } from '../../commands.js';
import { Pane } from '../design-system/Pane.js';
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

  useExitOnCtrlCDWithKeybindings();

  const handleEscape = React.useCallback(() => {
    if (tabsHidden) {
      return;
    }
    onClose('Usage dialog dismissed', { display: 'system' });
  }, [onClose, tabsHidden]);

  useKeybinding('confirm:no', handleEscape, {
    context: 'Settings',
    isActive: !tabsHidden && !(selectedTab === 'Config' && configOwnsEsc),
  });

  return (
    <Pane color="permission">
      <Tabs
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
    </Pane>
  );
}
