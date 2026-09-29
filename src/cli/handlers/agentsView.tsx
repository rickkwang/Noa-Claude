/**
 * Mounting the agents view: standalone for `noa agents`, or in place of the
 * REPL after `/background` moved the conversation out of this terminal.
 */
import * as React from 'react';
import { FleetView } from '../../components/FleetView/FleetView.js';
import { ThemeProvider } from '../../components/design-system/ThemeProvider.js';
import type { Root } from '../../ink.js';
import instances from '../../ink/instances.js';
import { getCwd } from '../../utils/cwd.js';
import { gracefulShutdown, suppressResumeHint } from '../../utils/gracefulShutdown.js';

export async function runAgentsView(root: Root, respawnFlags: string[], cwdFilter?: string): Promise<void> {
  await new Promise<void>(resolve => {
    root.render(<FleetView cwd={getCwd()} cwdFilter={cwdFilter} respawnFlags={respawnFlags} onExit={resolve} />);
  });
  root.unmount();
}

/**
 * Replace the running REPL's tree with the agents view. The REPL unmounts;
 * this process lives on only to show the list, and exits with it.
 */
export function replaceReplWithAgentsView(originShort: string, respawnFlags: string[]): void {
  const ink = instances.get(process.stdout);
  if (!ink) return;
  suppressResumeHint();
  const exit = () => void gracefulShutdown(0, 'other', {
    finalMessage: 'Background sessions keep running — `noa agents` shows them.'
  });
  ink.render(<ThemeProvider>
      <FleetView cwd={getCwd()} originShort={originShort} respawnFlags={respawnFlags} onExit={exit} />
    </ThemeProvider>);
}
