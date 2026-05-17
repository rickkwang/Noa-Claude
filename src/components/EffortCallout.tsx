// @ts-nocheck
import { c as _c } from "react/compiler-runtime";
import React, { useCallback, useEffect, useRef } from 'react';
import { Box, Text } from '../ink.js';
import { isMaxSubscriber, isProSubscriber, isTeamSubscriber } from '../utils/auth.js';
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js';
import type { EffortLevel } from '../utils/effort.js';
import { convertEffortValueToLevel, getDefaultEffortForModel, getOpusDefaultEffortConfig, getSupportedEffortLevelsForModel, toPersistableEffort } from '../utils/effort.js';
import { parseUserSpecifiedModel } from '../utils/model/model.js';
import { updateSettingsForSource } from '../utils/settings/settings.js';
import type { OptionWithDescription } from './CustomSelect/select.js';
import { Select } from './CustomSelect/select.js';
import { effortLevelToSymbol } from './EffortIndicator.js';
import { PermissionDialog } from './permissions/PermissionDialog.js';
type EffortCalloutSelection = EffortLevel | undefined | 'dismiss';
type Props = {
  model: string;
  onDone: (selection: EffortCalloutSelection) => void;
};
const AUTO_DISMISS_MS = 30_000;
export function EffortCallout(t0) {
  const $ = _c(22);
  const {
    model,
    onDone
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = getOpusDefaultEffortConfig();
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const defaultEffortConfig = t1;
  const onDoneRef = useRef(onDone);
  let t2;
  if ($[1] !== onDone) {
    t2 = () => {
      onDoneRef.current = onDone;
    };
    $[1] = onDone;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  useEffect(t2);
  let t3;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = () => {
      onDoneRef.current("dismiss");
    };
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  const handleCancel = t3;
  let t4;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = [];
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  useEffect(_temp, t4);
  let t5;
  let t6;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = () => {
      const timeoutId = setTimeout(handleCancel, AUTO_DISMISS_MS);
      return () => clearTimeout(timeoutId);
    };
    t6 = [handleCancel];
    $[5] = t5;
    $[6] = t6;
  } else {
    t5 = $[5];
    t6 = $[6];
  }
  useEffect(t5, t6);
  let t7;
  if ($[7] !== model) {
    const defaultEffort = getDefaultEffortForModel(model);
    t7 = defaultEffort ? convertEffortValueToLevel(defaultEffort) : "high";
    $[7] = model;
    $[8] = t7;
  } else {
    t7 = $[8];
  }
  const defaultLevel = t7;
  let t8;
  if ($[9] !== defaultLevel) {
    t8 = value => {
      const effortLevel = value === defaultLevel ? undefined : value;
      updateSettingsForSource("userSettings", {
        effortLevel: toPersistableEffort(effortLevel)
      });
      onDoneRef.current(value);
    };
    $[9] = defaultLevel;
    $[10] = t8;
  } else {
    t8 = $[10];
  }
  const handleSelect = t8;
  let t9;
  if ($[11] !== defaultLevel) {
    const maxText = defaultLevel === "max" ? "Max (recommended)" : "Max";
    const xhighText = defaultLevel === "xhigh" ? "XHigh (recommended)" : "XHigh";
    const highText = defaultLevel === "high" ? "High (recommended)" : "High";
    const mediumText = defaultLevel === "medium" ? "Medium (recommended)" : "Medium";
    t9 = [{
      label: <EffortOptionLabel level="max" text={maxText} />,
      value: "max"
    }, {
      label: <EffortOptionLabel level="xhigh" text={xhighText} />,
      value: "xhigh"
    }, {
      label: <EffortOptionLabel level="high" text={highText} />,
      value: "high"
    }, {
      label: <EffortOptionLabel level="medium" text={mediumText} />,
      value: "medium"
    }, {
      label: <EffortOptionLabel level="low" text="Low" />,
      value: "low"
    }];
    $[11] = defaultLevel;
    $[12] = t9;
  } else {
    t9 = $[12];
  }
  const supportedEffortLevels = getSupportedEffortLevelsForModel(model);
  const options = t9.filter(option => supportedEffortLevels.includes(option.value as EffortLevel));
  let t10;
  if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
    t10 = <Box marginBottom={1} flexDirection="column"><Text>{defaultEffortConfig.dialogDescription}</Text></Box>;
    $[13] = t10;
  } else {
    t10 = $[13];
  }
  const t13 = <Box marginBottom={1}><Text dimColor={true}>{supportedEffortLevels.map((level, index) => <React.Fragment key={level}>{index > 0 ? " · " : ""}<EffortIndicatorSymbol level={level} /> {level}</React.Fragment>)}</Text></Box>;
  const t14 = <PermissionDialog title={defaultEffortConfig.dialogTitle}><Box flexDirection="column" paddingX={2} paddingY={1}>{t10}{t13}<Select options={options} onChange={handleSelect} onCancel={handleCancel} /></Box></PermissionDialog>;
  return t14;
}
function _temp() {
  markV2Dismissed();
}
function EffortIndicatorSymbol(t0) {
  const $ = _c(4);
  const {
    level
  } = t0;
  let t1;
  if ($[0] !== level) {
    t1 = effortLevelToSymbol(level);
    $[0] = level;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] !== t1) {
    t2 = <Text color="suggestion">{t1}</Text>;
    $[2] = t1;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  return t2;
}
function EffortOptionLabel(t0) {
  const $ = _c(5);
  const {
    level,
    text
  } = t0;
  let t1;
  if ($[0] !== level) {
    t1 = <EffortIndicatorSymbol level={level} />;
    $[0] = level;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] !== t1 || $[3] !== text) {
    t2 = <>{t1} {text}</>;
    $[2] = t1;
    $[3] = text;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  return t2;
}

/**
 * Show the callout only when the current model has an explicit default effort
 * so the user can opt out of that recommendation once.
 */
export function shouldShowEffortCallout(model: string): boolean {
  const parsed = parseUserSpecifiedModel(model);
  if (getDefaultEffortForModel(parsed) === undefined) {
    return false;
  }
  const config = getGlobalConfig();
  if (config.effortCalloutV2Dismissed) return false;

  // Don't show to brand-new users — they never knew the old default, so this
  // isn't a change for them. Mark as dismissed so it stays suppressed.
  if (config.numStartups <= 1) {
    markV2Dismissed();
    return false;
  }

  // Reuse the v1 dismissal bit so users who already dismissed the earlier
  // effort guidance do not get prompted again.
  if (isProSubscriber()) {
    if (config.effortCalloutDismissed) {
      markV2Dismissed();
      return false;
    }
    return getOpusDefaultEffortConfig().enabled;
  }

  if (isMaxSubscriber() || isTeamSubscriber()) {
    return getOpusDefaultEffortConfig().enabled;
  }

  // Everyone else (free tier, API key, non-subscribers): not in scope.
  markV2Dismissed();
  return false;
}
function markV2Dismissed(): void {
  saveGlobalConfig(current => {
    if (current.effortCalloutV2Dismissed) return current;
    return {
      ...current,
      effortCalloutV2Dismissed: true
    };
  });
}
