// @ts-nocheck
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useEffect, useState } from 'react';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../services/analytics/index.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { type EffortValue, getDisplayedEffortLevel, getEffortEnvOverride, getEffortValueDescription, isEffortLevel, modelSupportsEffort, resolveAppliedEffort, toPersistableEffort } from '../../utils/effort.js';
import { getMainLoopModel } from '../../utils/model/model.js';
import { get3PModelCapabilityOverride } from '../../utils/model/modelSupportOverrides.js';
import { getAPIProvider, isFirstPartyAnthropicBaseUrl } from '../../utils/model/providers.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';
import { Box, Text, useInput } from '../../ink.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { getRainbowColor } from '../../utils/thinking.js';
const COMMON_HELP_ARGS = ['help', '-h', '--help'];
type EffortCommandResult = {
  message: string;
  effortUpdate?: {
    value: EffortValue | undefined;
  };
};
function setEffortValue(effortValue: EffortValue, model?: string): EffortCommandResult {
  if (model !== undefined && !modelSupportsEffort(model)) {
    return {
      message: `Effort is not supported for current model/provider (${model}); no change made`
    };
  }
  const persistable = toPersistableEffort(effortValue);
  if (persistable !== undefined) {
    const result = updateSettingsForSource('userSettings', {
      effortLevel: persistable
    });
    if (result.error) {
      return {
        message: `Failed to set effort level: ${result.error.message}`
      };
    }
  }
  logEvent('tengu_effort_command', {
    effort: effortValue as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });

  // Env var wins at resolveAppliedEffort time. Only flag it when it actually
  // conflicts — if env matches what the user just asked for, the outcome is
  // the same, so "Set effort to X" is true and the note is noise.
  const envOverride = getEffortEnvOverride();
  if (envOverride !== undefined && envOverride !== effortValue) {
    const envRaw = process.env.CLAUDE_CODE_EFFORT_LEVEL;
    if (persistable === undefined) {
      return {
        message: `Not applied: CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides effort this session, and ${effortValue} is session-only (nothing saved)`,
        effortUpdate: {
          value: effortValue
        }
      };
    }
    return {
      message: `CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides this session — clear it and ${effortValue} takes over`,
      effortUpdate: {
        value: effortValue
      }
    };
  }
  const description = getEffortValueDescription(effortValue);
  const suffix = persistable !== undefined ? '' : ' (this session only)';
  const providerWarning = model === undefined || isEffortSentToProvider(model) ? '' : '\nNote: current provider may not support the effort parameter';
  const effectiveSuffix = (() => {
    if (model === undefined || typeof effortValue !== 'string') return '';
    const effective = resolveAppliedEffort(model, effortValue);
    return effective !== undefined && effective !== effortValue ? `; current model will use ${effective}` : '';
  })();
  return {
    message: `Set effort level to ${effortValue}${suffix}${effectiveSuffix}: ${description}${providerWarning}`,
    effortUpdate: {
      value: effortValue
    }
  };
}
function isEffortSentToProvider(model: string): boolean {
  const provider = getAPIProvider();
  if (provider === 'foundry') return true;
  if (provider === 'firstParty' && isFirstPartyAnthropicBaseUrl()) return true;
  return get3PModelCapabilityOverride(model, 'effort') === true || get3PModelCapabilityOverride(model, 'max_effort') === true || get3PModelCapabilityOverride(model, 'xhigh_effort') === true;
}

export function showCurrentEffort(appStateEffort: EffortValue | undefined, model: string): EffortCommandResult {
  const envOverride = getEffortEnvOverride();
  const requestedValue = envOverride === null ? undefined : envOverride ?? appStateEffort;
  if (!modelSupportsEffort(model)) {
    return {
      message:
        requestedValue === undefined
          ? `Effort is not supported for current model/provider (${model})`
          : `Current effort level: ${requestedValue} (not supported by current model/provider)`
    };
  }
  if (requestedValue === undefined) {
    const level = getDisplayedEffortLevel(model, appStateEffort);
    return {
      message: `Effort level: auto (currently ${level})`
    };
  }
  const appliedValue = resolveAppliedEffort(model, appStateEffort);
  if (appliedValue === undefined) {
    return {
      message: `Current effort level: ${requestedValue} (not supported by current model/provider)`
    };
  }
  const description = getEffortValueDescription(appliedValue);
  const configuredSuffix = appliedValue !== requestedValue ? ` (configured ${requestedValue})` : '';
  return {
    message: `Current effort level: ${appliedValue}${configuredSuffix} (${description})`
  };
}
function unsetEffortLevel(): EffortCommandResult {
  const result = updateSettingsForSource('userSettings', {
    effortLevel: undefined
  });
  if (result.error) {
    return {
      message: `Failed to set effort level: ${result.error.message}`
    };
  }
  logEvent('tengu_effort_command', {
    effort: 'auto' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });
  // env=auto/unset (null) matches what /effort auto asks for, so only warn
  // when env is pinning a specific level that will keep overriding.
  const envOverride = getEffortEnvOverride();
  if (envOverride !== undefined && envOverride !== null) {
    const envRaw = process.env.CLAUDE_CODE_EFFORT_LEVEL;
    return {
      message: `Cleared effort from settings, but CLAUDE_CODE_EFFORT_LEVEL=${envRaw} still controls this session`,
      effortUpdate: {
        value: undefined
      }
    };
  }
  return {
    message: 'Effort level set to auto',
    effortUpdate: {
      value: undefined
    }
  };
}
export function executeEffort(args: string, model?: string): EffortCommandResult {
  const normalized = args.toLowerCase();
  if (normalized === 'auto' || normalized === 'unset') {
    return unsetEffortLevel();
  }
  if (!isEffortLevel(normalized)) {
    return {
      message: `Invalid argument: ${args}. Valid options are: low, medium, high, xhigh, max, auto`
    };
  }
  return setEffortValue(normalized, model);
}
function ShowCurrentEffort(t0) {
  const {
    onDone
  } = t0;
  const effortValue = useAppState(_temp);
  const model = useMainLoopModel();
  const {
    message
  } = showCurrentEffort(effortValue, model);
  onDone(message);
  return null;
}
function _temp(s) {
  return s.effortValue;
}
function ApplyEffortAndClose(t0) {
  const $ = _c(6);
  const {
    result,
    onDone
  } = t0;
  const setAppState = useSetAppState();
  const {
    effortUpdate,
    message
  } = result;
  let t1;
  let t2;
  if ($[0] !== effortUpdate || $[1] !== message || $[2] !== onDone || $[3] !== setAppState) {
    t1 = () => {
      if (effortUpdate) {
        setAppState(prev => ({
          ...prev,
          effortValue: effortUpdate.value
        }));
      }
      onDone(message);
    };
    t2 = [setAppState, effortUpdate, message, onDone];
    $[0] = effortUpdate;
    $[1] = message;
    $[2] = onDone;
    $[3] = setAppState;
    $[4] = t1;
    $[5] = t2;
  } else {
    t1 = $[4];
    t2 = $[5];
  }
  React.useEffect(t1, t2);
  return null;
}
const SLIDER_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const SEGMENT_WIDTH = 11;

type SliderLevel = (typeof SLIDER_LEVELS)[number];

function useShimmerOffset(active: boolean): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setOffset(o => o + 1), 120);
    return () => clearInterval(id);
  }, [active]);
  return offset;
}

function RainbowText({ text, shimmer, offset, bold = false }: { text: string; shimmer: boolean; offset: number; bold?: boolean }): React.ReactNode {
  return (
    <Text bold={bold}>
      {[...text].map((ch, i) => (
        <Text key={i} color={getRainbowColor(i + offset, shimmer) as any} bold={bold}>
          {ch}
        </Text>
      ))}
    </Text>
  );
}

function LevelLabel({ level, selected, shimmerOffset }: { level: SliderLevel; selected: boolean; shimmerOffset: number }): React.ReactNode {
  if (!selected) return <Text dimColor>{level}</Text>;
  if (level === 'xhigh') return <RainbowText text={level} shimmer={true} offset={shimmerOffset} bold />;
  if (level === 'max') return <RainbowText text={level} shimmer={false} offset={shimmerOffset} bold />;
  // Color values must use the 'ansi:' prefix in this fork's Color type.
  const colorMap: Record<string, string> = {
    low: 'ansi:yellowBright',
    medium: 'ansi:greenBright',
    high: 'ansi:magentaBright',
  };
  return (
    <Text color={colorMap[level] as any} bold>
      {level}
    </Text>
  );
}

function EffortSlider({ onDone, model }: { onDone: LocalJSXCommandOnDone; model: string }): React.ReactNode {
  const currentEffort = useAppState((s: any) => s.effortValue);
  const setAppState = useSetAppState();
  const { columns } = useTerminalSize();
  const exitState = useExitOnCtrlCDWithKeybindings();

  const initialIdx = (() => {
    const envOverride = getEffortEnvOverride();
    const effective = envOverride ?? (typeof currentEffort === 'string' ? currentEffort : undefined);
    if (effective) {
      const i = SLIDER_LEVELS.indexOf(effective as any);
      if (i !== -1) return i;
    }
    return 1;
  })();

  const [selectedIdx, setSelectedIdx] = useState(initialIdx);
  const selectedLevel = SLIDER_LEVELS[selectedIdx];
  const shimmerActive = selectedLevel === 'xhigh' || selectedLevel === 'max';
  const shimmerOffset = useShimmerOffset(shimmerActive);

  useInput((_input: string, key: any) => {
    if (key.leftArrow) {
      setSelectedIdx((i: number) => Math.max(0, i - 1));
    } else if (key.rightArrow) {
      setSelectedIdx((i: number) => Math.min(SLIDER_LEVELS.length - 1, i + 1));
    } else if (key.return) {
      const level = SLIDER_LEVELS[selectedIdx];
      const result = setEffortValue(level, model);
      if (result.effortUpdate) {
        setAppState((prev: any) => ({ ...prev, effortValue: result.effortUpdate!.value }));
      }
      onDone(result.message);
    } else if (key.escape) {
      onDone('Effort unchanged', { display: 'system' } as any);
    }
  });

  // Labels are left-aligned in fixed-width slots (SEGMENT_WIDTH). The line
  // spans from the start of the first label to the end of the last label, and
  // the triangle sits at the center of the selected label's text.
  const lastLabel = SLIDER_LEVELS[SLIDER_LEVELS.length - 1];
  const sliderWidth = (SLIDER_LEVELS.length - 1) * SEGMENT_WIDTH + lastLabel.length;
  const trianglePos = selectedIdx * SEGMENT_WIDTH + Math.floor((SLIDER_LEVELS[selectedIdx].length - 1) / 2);
  const line = '─'.repeat(trianglePos) + '▲' + '─'.repeat(sliderWidth - trianglePos - 1);
  const leftPad = Math.max(0, Math.floor((columns - sliderWidth) / 2));

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Box flexDirection="column" paddingLeft={leftPad}>
        <Box flexDirection="row" width={sliderWidth} justifyContent="space-between">
          <Text dimColor>Speed</Text>
          <Text dimColor>Intelligence</Text>
        </Box>
        <Text dimColor>{line}</Text>
        <Box flexDirection="row">
          {SLIDER_LEVELS.map((level, i) => {
            const isLast = i === SLIDER_LEVELS.length - 1;
            const trailing = isLast ? 0 : SEGMENT_WIDTH - level.length;
            return (
              <React.Fragment key={level}>
                <LevelLabel level={level} selected={i === selectedIdx} shimmerOffset={shimmerOffset} />
                {trailing > 0 && <Text>{' '.repeat(trailing)}</Text>}
              </React.Fragment>
            );
          })}
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {exitState.pending
            ? `Press ${exitState.keyName} again to exit`
            : '←/→ to change effort · Enter to confirm · Esc to cancel'}
        </Text>
      </Box>
    </Box>
  );
}

export async function call(rawOnDone: LocalJSXCommandOnDone, _context: any, args?: string): Promise<React.ReactNode> {
  // Wrap onDone so command output doesn't leak into the model context.
  // SystemLocalCommandMessage ('system') is wrapped as a user message by
  // normalizeMessagesForAPI and shipped to the API; the default user-message
  // path also injects. Route everything (except already-skip) through a
  // transient notification + display:'skip' so the transcript and API stay
  // clean while the user still sees the result.
  const onDone: LocalJSXCommandOnDone = (msg, options) => {
    const display = options?.display;
    if (msg && display !== 'skip') {
      _context?.addNotification?.({
        key: `effort-cmd-${Date.now()}`,
        text: msg,
        priority: 'medium',
      });
      rawOnDone(msg, { ...options, display: 'skip' });
      return;
    }
    rawOnDone(msg, options);
  };
  args = args?.trim() || '';
  if (COMMON_HELP_ARGS.includes(args)) {
    onDone('Usage: /effort [low|medium|high|xhigh|max|auto]\n\nEffort levels:\n- low: Quick, straightforward implementation\n- medium: Balanced approach with standard testing\n- high: Comprehensive implementation with extensive testing\n- xhigh: Extended capability for long-horizon agentic work (Opus 4.7+)\n- max: Maximum capability with deepest reasoning (Opus 4.6+)\n- auto: Use the default effort level for your model');
    return;
  }
  if (!args) {
    const model = getMainLoopModel();
    if (!modelSupportsEffort(model)) {
      onDone(`Effort is not supported for current model/provider (${model})`);
      return;
    }
    return <EffortSlider onDone={onDone} model={model} />;
  }
  if (args === 'current' || args === 'status') {
    return <ShowCurrentEffort onDone={onDone} />;
  }
  const result = executeEffort(args, getMainLoopModel());
  return <ApplyEffortAndClose result={result} onDone={onDone} />;
}
