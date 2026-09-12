// @ts-nocheck
import * as React from 'react';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import { PluginSettings } from './PluginSettings.js';
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext, args?: string): Promise<React.ReactNode> {
  // dispatchedAsImmediate means a turn is still streaming, so the
  // /reload-plugins this dialog queues on close won't run until it ends —
  // PluginSettings says so instead of closing silently.
  return <PluginSettings onComplete={onDone} args={args} midTurn={context?.dispatchedAsImmediate === true} />;
}
