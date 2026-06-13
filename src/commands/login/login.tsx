// @ts-nocheck
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { clearTrustedDeviceToken, enrollTrustedDevice } from '../../bridge/trustedDevice.js';
import type { LocalJSXCommandContext } from '../../commands.js';
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js';
import { ConsoleOAuthFlow, type ConsoleOAuthFlowResult } from '../../components/ConsoleOAuthFlow.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { Text } from '../../ink.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import {
  applyActiveProviderProfileEnv,
  deactivateAllProviderProfiles,
} from '../../utils/providerProfile.js';
import { onProviderSwitch } from '../../utils/providerSwitch.js';
type LoginCompletion = ConsoleOAuthFlowResult | {
  type: 'cancel';
};
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  return <Login onDone={async result => {
    if (result.type === 'cancel') {
      onDone('Login interrupted');
      return;
    }
    const isProviderSetup = result.type === 'provider-setup'
    if (!isProviderSetup) {
      // Standard OAuth login: deactivate any active 3P provider profile so the
      // new OAuth token takes effect. applyActiveProviderProfileEnv with no
      // active profile clears ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN etc.
      await deactivateAllProviderProfiles()
      await applyActiveProviderProfileEnv()
    }
    if (!isProviderSetup) {
      // Trusted device enrollment is Anthropic-specific; skip for 3P providers.
      clearTrustedDeviceToken();
      void enrollTrustedDevice();
    }
    onProviderSwitch(context);
    if (isProviderSetup) {
      onDone(result.message, {
        display: 'system'
      });
      return;
    }
    onDone('Login successful');
  }} />;
}
export function Login(props) {
  const $ = _c(12);
  const mainLoopModel = useMainLoopModel();
  let t0;
  if ($[0] !== mainLoopModel || $[1] !== props) {
    t0 = () => props.onDone({
      type: 'cancel'
    }, mainLoopModel);
    $[0] = mainLoopModel;
    $[1] = props;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  let t1;
  if ($[3] !== mainLoopModel || $[4] !== props) {
    t1 = result => props.onDone(result ?? {
      type: 'cancel'
    }, mainLoopModel);
    $[3] = mainLoopModel;
    $[4] = props;
    $[5] = t1;
  } else {
    t1 = $[5];
  }
  let t2;
  if ($[6] !== props.startingMessage || $[7] !== t1) {
    t2 = <ConsoleOAuthFlow onDone={t1} startingMessage={props.startingMessage} />;
    $[6] = props.startingMessage;
    $[7] = t1;
    $[8] = t2;
  } else {
    t2 = $[8];
  }
  let t3;
  if ($[9] !== t0 || $[10] !== t2) {
    t3 = <Dialog title="Login" onCancel={t0} color="permission" inputGuide={_temp}>{t2}</Dialog>;
    $[9] = t0;
    $[10] = t2;
    $[11] = t3;
  } else {
    t3 = $[11];
  }
  return t3;
}
function _temp(exitState) {
  return exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />;
}
