// @ts-nocheck
import * as React from 'react';
import { UsageDashboard } from '../../components/Settings/UsageDashboard.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
export const call: LocalJSXCommandCall = async (onDone, context) => {
  return <UsageDashboard onClose={onDone} context={context} defaultTab="Stats" />;
};
