import {
  CRON_CREATE_TOOL_NAME,
  CRON_DELETE_TOOL_NAME,
  DEFAULT_MAX_AGE_DAYS,
} from '../../tools/ScheduleCronTool/prompt.js';
import { SCHEDULE_WAKEUP_TOOL_NAME } from '../../tools/ScheduleWakeupTool/prompt.js';

export type LoopMode =
  | 'dynamic-prompt'
  | 'dynamic-maintenance'
  | 'fixed-prompt'
  | 'fixed-maintenance';

export type ParsedLoopArgs = {
  mode: LoopMode;
  interval?: string;
  prompt?: string;
};

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
  const trimmed = args.trim();
  if (!trimmed) return { mode: 'dynamic-maintenance' };

  const bareInterval = parseIntervalToken(trimmed);
  if (bareInterval) {
    return toFixedMode(bareInterval);
  }

  const [firstToken, ...restTokens] = trimmed.split(/\s+/);
  const leadingInterval = parseIntervalToken(firstToken ?? '');
  if (leadingInterval) {
    const prompt = restTokens.join(' ').trim();
    return toFixedMode(leadingInterval, prompt);
  }

  const trailingEvery = parseTrailingEveryClause(trimmed);
  if (trailingEvery) {
    return toFixedMode(trailingEvery.interval, trailingEvery.prompt);
  }

  return {
    mode: 'dynamic-prompt',
    prompt: trimmed,
  };
}

export function buildPromptForMode(parsed: ParsedLoopArgs): string {
  if (parsed.prompt?.trim().match(/^\/loop(?:\s|$)/)) {
    return `# /loop - nested loop rejected

Loop stopped because nested /loop prompts are not allowed.

Do not execute the nested loop and do not schedule another run. Tell the user to run one loop at a time.
`;
  }
  return isFixedMode(parsed.mode)
    ? buildFixedPrompt(parsed)
    : buildDynamicPrompt(parsed);
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

function buildDynamicPrompt(parsed: ParsedLoopArgs): string {
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
  const wakeupPrompt = parsed.prompt ? `/loop ${parsed.prompt}` : '/loop';

  return `# /loop - dynamic self-pacing

The user invoked /loop without a fixed interval and wants you to self-pace. Decide what makes the next iteration worth running — a passage of time, or an observable event.

${effectivePromptInstructions}
## Instructions

1. **Run the effective prompt now.** If it's a slash command, invoke it via the Skill tool; otherwise act on it directly.
2. **If the next run is gated on an event** (CI finishing, a log line matching, a file changing, a PR comment) and you have not already armed a Monitor for it: arm one now with the Monitor tool and \`persistent: true\`. Its events arrive as \`<task-notification>\` messages and wake this loop immediately — you do not wait for the ${SCHEDULE_WAKEUP_TOOL_NAME} deadline. Arm it once, not on every iteration.
3. **Decide whether the loop continues.** If the task needs another iteration, call ${SCHEDULE_WAKEUP_TOOL_NAME} with:
   - \`delaySeconds\`: with a Monitor armed this is the **fallback heartbeat** — how long to wait if no event fires (lean 1200–1800s; idle ticks more frequent than the task needs are pure overhead). Without a Monitor this is the cadence — pick based on what you observed. Read the tool's own description for cache-aware delay guidance.
   - \`reason\`: one short sentence on why you picked that delay.
   - \`prompt\`: exactly \`${wakeupPrompt}\`, so the next firing re-enters this skill and continues the loop.
   If it doesn't need another iteration, stop instead (step 6) — re-arming is a per-turn choice, not a default.
4. **After the wakeup is armed, briefly confirm**: that you're self-pacing, whether a Monitor is the primary wake signal, that you ran the task now, and what delay you picked.
5. **If you were woken by a \`<task-notification>\`** rather than this prompt: handle the event in the context of the loop task, then make the same decision. If the loop should continue, call ${SCHEDULE_WAKEUP_TOOL_NAME} again with the same \`prompt\` and a 1200–1800s \`delaySeconds\` (the Monitor remains the wake signal; the new wakeup is only the fallback heartbeat), then write a brief update. If the event means the work is finished, stop (step 6).
6. **To stop the loop** — the task is complete, further iterations can't make progress, or the user asked you to stop — call ${SCHEDULE_WAKEUP_TOOL_NAME} with \`stop: true\` (no other fields) and stop any Monitor you armed with TaskStop. Then write the loop's outcome for the user as ordinary visible response text — a stopped loop has no next tick to surface it. Stopping is the loop's normal ending — the user can restart it anytime with /loop.
`;
}
