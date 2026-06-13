// @ts-nocheck
import * as React from 'react';
import type { LocalJSXCommandContext } from '../../commands.js';
import { UsageDashboard } from '../../components/Settings/UsageDashboard.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  return <UsageDashboard onClose={onDone} context={context} defaultTab="Status" />;
}
