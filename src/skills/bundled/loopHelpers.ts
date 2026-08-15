import {
  CRON_CREATE_TOOL_NAME,
  CRON_DELETE_TOOL_NAME,
  DEFAULT_MAX_AGE_DAYS,
} from '../../tools/ScheduleCronTool/prompt.js';
import {
  consumeDynamicLoopState,
  DYNAMIC_LOOP_MAX_ITERATIONS,
  DYNAMIC_LOOP_MAX_WALL_CLOCK_MS,
  DYNAMIC_LOOP_STATE_PREFIX,
  issueDynamicLoopState,
  newDynamicLoopChainId,
  type DynamicLoopState,
} from '../../utils/dynamicLoopState.js';

export type LoopMode =
  | 'dynamic-prompt'
  | 'dynamic-maintenance'
  | 'fixed-prompt'
  | 'fixed-maintenance';

export type ParsedLoopArgs = {
  mode: LoopMode;
  interval?: string;
  prompt?: string;
  loopState?: DynamicLoopState;
  invalidLoopState?: boolean;
};

type DynamicLoopBuildOptions = {
  nowMs?: number;
  /** Stable label reported to the user. Distinct from the scheduling token. */
  createChainId?: () => string;
  /** Single-use capability minted for the next iteration. Test seam only. */
  createToken?: () => string;
};

const DYNAMIC_MIN_DELAY = '1 minute';
const DYNAMIC_MAX_DELAY = '1 hour';

const MAINTENANCE_PROMPT = `Scheduled maintenance loop iteration.

If .noa/loop.md exists, read it and follow it.
Otherwise, if ~/.noa/loop.md exists, read it and follow it.
Otherwise:
- continue any unfinished work from the conversation
- tend to the current branch's pull request: review comments, failed CI runs, merge conflicts
- run cleanup passes such as bug hunts or simplification when nothing else is pending

Do not start new initiatives outside that scope.
Irreversible actions such as pushing or deleting only proceed when they continue something the transcript already authorized.`;

function normalizeIntervalUnit(rawUnit: string): 's' | 'm' | 'h' | 'd' | null {
  const unit = rawUnit.toLowerCase();
  if (['s', 'sec', 'secs', 'second', 'seconds'].includes(unit)) return 's';
  if (['m', 'min', 'mins', 'minute', 'minutes'].includes(unit)) return 'm';
  if (['h', 'hr', 'hrs', 'hour', 'hours'].includes(unit)) return 'h';
  if (['d', 'day', 'days'].includes(unit)) return 'd';
  return null;
}

function parseIntervalToken(token: string): string | null {
  const match = token.trim().match(/^(\d+)\s*([a-zA-Z]+)$/);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 10);
  if (!Number.isFinite(value) || value < 1) return null;
  const unit = normalizeIntervalUnit(match[2]!);
  if (!unit) return null;
  return `${value}${unit}`;
}

function parseTrailingEveryClause(input: string): {
  prompt: string;
  interval: string;
} | null {
  const match = input.match(/^(.*?)(?:\s+every\s+)(\d+)\s*([a-zA-Z]+)\s*$/i);
  if (!match) return null;
  const interval = parseIntervalToken(`${match[2]!}${match[3]!}`);
  if (!interval) return null;
  return {
    prompt: match[1]!.trim(),
    interval,
  };
}

function toFixedMode(interval: string, prompt?: string): ParsedLoopArgs {
  if (!prompt) return { mode: 'fixed-maintenance', interval };
  return {
    mode: 'fixed-prompt',
    interval,
    prompt,
  };
}

function isFixedMode(mode: LoopMode): boolean {
  return mode === 'fixed-prompt' || mode === 'fixed-maintenance';
}

export function parseLoopArgs(args: string): ParsedLoopArgs {
  let trimmed = args.trim();
  let loopState: DynamicLoopState | undefined;
  let invalidLoopState = false;
  const hasDynamicLoopStateMarker = trimmed.startsWith(
    DYNAMIC_LOOP_STATE_PREFIX,
  );
  if (hasDynamicLoopStateMarker) {
    const tokenEnd = trimmed.search(/\s/);
    const markerToken = tokenEnd === -1 ? trimmed : trimmed.slice(0, tokenEnd);
    const encodedState = markerToken.slice(DYNAMIC_LOOP_STATE_PREFIX.length);
    loopState = /^[A-Za-z0-9_-]+$/.test(encodedState)
      ? consumeDynamicLoopState(encodedState)
      : undefined;
    invalidLoopState = loopState === undefined;
    trimmed = tokenEnd === -1 ? '' : trimmed.slice(tokenEnd).trim();
  }

  const withLoopState = (parsed: ParsedLoopArgs): ParsedLoopArgs => ({
    ...parsed,
    ...(loopState ? { loopState } : {}),
    ...(invalidLoopState ? { invalidLoopState: true } : {}),
  });

  if (hasDynamicLoopStateMarker) {
    return withLoopState(
      trimmed
        ? { mode: 'dynamic-prompt', prompt: trimmed }
        : { mode: 'dynamic-maintenance' },
    );
  }

  if (!trimmed) return withLoopState({ mode: 'dynamic-maintenance' });

  const bareInterval = parseIntervalToken(trimmed);
  if (bareInterval) {
    return withLoopState(toFixedMode(bareInterval));
  }

  const [firstToken, ...restTokens] = trimmed.split(/\s+/);
  const leadingInterval = parseIntervalToken(firstToken ?? '');
  if (leadingInterval) {
    const prompt = restTokens.join(' ').trim();
    return withLoopState(toFixedMode(leadingInterval, prompt));
  }

  const trailingEvery = parseTrailingEveryClause(trimmed);
  if (trailingEvery) {
    return withLoopState(toFixedMode(trailingEvery.interval, trailingEvery.prompt));
  }

  return withLoopState({
    mode: 'dynamic-prompt',
    prompt: trimmed,
  });
}

export function buildPromptForMode(
  parsed: ParsedLoopArgs,
  options: DynamicLoopBuildOptions = {},
): string {
  if (parsed.prompt?.trim().match(/^\/loop(?:\s|$)/)) {
    return `# /loop - nested loop rejected

Loop stopped because nested /loop prompts are not allowed.

Do not execute the nested loop and do not schedule another run. Tell the user to run one loop at a time.
`;
  }
  return isFixedMode(parsed.mode)
    ? buildFixedPrompt(parsed)
    : buildDynamicPrompt(parsed, options);
}

function buildFixedPrompt(parsed: ParsedLoopArgs): string {
  const targetInstructions = parsed.prompt
    ? `Use this prompt verbatim for both the immediate run and the recurring scheduled task:

--- BEGIN PROMPT ---
${parsed.prompt}
--- END PROMPT ---
`
    : `This is a maintenance loop with no explicit prompt.

For the recurring scheduled task, use this exact maintenance prompt body:

--- BEGIN MAINTENANCE PROMPT ---
${MAINTENANCE_PROMPT}
--- END MAINTENANCE PROMPT ---
`;

  return `# /loop - fixed recurring interval

The user invoked /loop with a fixed interval.

Requested interval: ${parsed.interval}

${targetInstructions}
## Instructions

1. Convert the requested interval to a recurring cron expression.
   - Supported suffixes: s, m, h, d.
   - Seconds must be rounded up to the nearest minute because cron has minute granularity.
   - If the requested interval does not map cleanly to cron cadence, choose the nearest clean recurring interval and tell the user what you picked.
2. Call ${CRON_CREATE_TOOL_NAME} with:
   - the recurring cron expression
   - the effective prompt body above
   - recurring: true
   - durable: false
3. Briefly confirm what was scheduled, the cron expression, the human cadence, that recurring tasks auto-expire after ${DEFAULT_MAX_AGE_DAYS} days, and that the user can cancel sooner with ${CRON_DELETE_TOOL_NAME} using the returned job ID.
4. Immediately execute the effective prompt now - do not wait for the first cron fire.
   - If the effective prompt starts with a slash command, invoke it via the Skill tool.
   - Otherwise, act on it directly.
`;
}

function buildDynamicPrompt(
  parsed: ParsedLoopArgs,
  options: DynamicLoopBuildOptions,
): string {
  if (parsed.invalidLoopState) {
    return `# /loop - invalid chain state

Dynamic loop stopped because its chain state is invalid.

Do not execute the effective prompt and do not schedule another run. Tell the user the scheduled loop state was malformed and that they can invoke /loop again to start a new chain.
`;
  }

  const nowMs = options.nowMs ?? Date.now();
  // Iteration 1 mints the chain's own id here. It is a label the model prints
  // back to the user, so it must never be the scheduling token that grants
  // re-entry into the chain.
  const state = parsed.loopState ?? ({
    chainId: (options.createChainId ?? newDynamicLoopChainId)(),
    iteration: 1,
    startedAtMs: nowMs,
  } satisfies DynamicLoopState);

  if (state.startedAtMs > nowMs) {
    return `# /loop - invalid chain state

Dynamic loop stopped because its chain state is invalid.

Do not execute the effective prompt and do not schedule another run. The carried start time is in the future; tell the user that the session clock may have moved backwards and that they can invoke /loop again to start a new chain.
`;
  }
  if (nowMs - state.startedAtMs >= DYNAMIC_LOOP_MAX_WALL_CLOCK_MS) {
    return `# /loop - run budget exhausted

Dynamic loop stopped before iteration ${state.iteration}. The chain reached its 24-hour wall-clock budget.

Do not execute the effective prompt and do not schedule another run. Tell the user the loop stopped because its run budget was exhausted. The user can invoke /loop again to start a new chain.
`;
  }
  if (state.iteration > DYNAMIC_LOOP_MAX_ITERATIONS) {
    return `# /loop - run budget exhausted

Dynamic loop stopped before iteration ${state.iteration}. The chain exceeded its ${DYNAMIC_LOOP_MAX_ITERATIONS}-iteration budget.

Do not execute the effective prompt and do not schedule another run. Tell the user the loop stopped because its run budget was exhausted. The user can invoke /loop again to start a new chain.
`;
  }
  const effectivePromptInstructions = parsed.prompt
    ? `Use this prompt verbatim as the effective prompt for this iteration:

--- BEGIN PROMPT ---
${parsed.prompt}
--- END PROMPT ---
`
    : `This is a maintenance loop with no explicit prompt.

Determine the effective prompt in this order:
1. If .noa/loop.md exists, read it and use it.
2. Otherwise, if ~/.noa/loop.md exists, read it and use it.
3. Otherwise, use this built-in maintenance prompt:

--- BEGIN MAINTENANCE PROMPT ---
${MAINTENANCE_PROMPT}
--- END MAINTENANCE PROMPT ---
`;

  if (state.iteration === DYNAMIC_LOOP_MAX_ITERATIONS) {
    return `# /loop - final dynamic iteration

This is the final allowed iteration ${state.iteration} of ${DYNAMIC_LOOP_MAX_ITERATIONS} for dynamic loop chain ${state.chainId}.

${effectivePromptInstructions}## Instructions

1. Execute the effective prompt now.
   - If it starts with a slash command, invoke it via the Skill tool.
   - Otherwise, act on it directly.
2. Tell the user that the dynamic loop reached its iteration budget.
3. Do not schedule another run.
`;
  }

  // The token is single-use and always freshly generated; the chain id carries
  // forward unchanged so every iteration reports the same chain to the user.
  const nextToken = issueDynamicLoopState({
    chainId: state.chainId,
    iteration: state.iteration + 1,
    startedAtMs: state.startedAtMs,
  }, options.createToken, nowMs);
  const reschedulePrompt = `/loop ${DYNAMIC_LOOP_STATE_PREFIX}${nextToken}${parsed.prompt ? ` ${parsed.prompt}` : ''}`;

  return `# /loop - dynamic rescheduling

The user invoked /loop without a fixed interval.

Run budget: iteration ${state.iteration} of ${DYNAMIC_LOOP_MAX_ITERATIONS}; chain ${state.chainId}; maximum wall-clock lifetime 24 hours.

${effectivePromptInstructions}
## Instructions

1. Execute the effective prompt now.
   - If it starts with a slash command, invoke it via the Skill tool.
   - Otherwise, act on it directly.
2. After the work finishes, choose the next delay dynamically between ${DYNAMIC_MIN_DELAY} and ${DYNAMIC_MAX_DELAY}.
   - Use shorter delays while active work is progressing or likely to change soon.
   - Use longer delays when the situation is quiet or stable.
3. Briefly tell the user the chosen delay and the reason.
4. Schedule exactly one session-only follow-up run with ${CRON_CREATE_TOOL_NAME}.
   - Use recurring: false.
   - Use durable: false.
   - Pin the cron expression to a specific future local-time minute that matches the chosen delay.
   - Set the scheduled prompt to this exact text so the next iteration stays in dynamic mode:

--- BEGIN SCHEDULED PROMPT ---
${reschedulePrompt}
--- END SCHEDULED PROMPT ---

5. Confirm the next run time and the returned job ID.
6. Do not create a recurring cron for this mode.
`;
}
