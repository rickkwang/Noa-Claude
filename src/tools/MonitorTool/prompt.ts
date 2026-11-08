export const MONITOR_TOOL_NAME = 'Monitor'

export const DEFAULT_MONITOR_TIMEOUT_MS = 300_000
export const MAX_MONITOR_TIMEOUT_MS = 3_600_000

export const DESCRIPTION = `Start a background monitor that streams events from a long-running script. Each stdout line is an event — you keep working and notifications arrive in the chat. Events arrive on their own schedule and are not replies from the user, even if one lands while you're waiting for the user to answer a question.

Pick by how many notifications you need:
- **One** ("tell me when the server is ready / the build finishes") → use Bash with \`run_in_background\` and a command that exits when the condition is true, e.g. \`until grep -q "Ready in" dev.log; do sleep 0.5; done\`. You get a single completion notification when it exits.
- **One per occurrence** ("show each ERROR line in the dev server's log while you try the change") → use Monitor with an unbounded command (\`tail -f\`, \`inotifywait -m\`, \`while true\`).

Lines that arrive close together are batched into one notification. The monitor stops when the command exits, when timeout_ms elapses (default ${DEFAULT_MONITOR_TIMEOUT_MS}, max ${MAX_MONITOR_TIMEOUT_MS}), or when TaskStop is called with its task_id. Set persistent to run until TaskStop or the session ends instead.

Keep working after starting a monitor. Do not poll or sleep for it.`
