import { registerBundledSkill } from '../bundledSkills.js'

const RUN_DESCRIPTION =
  'Launch and drive this project\'s app to see a change working. Use when asked to run, start, or screenshot the app, or to confirm a change works in the real app (not just tests). First looks for a project skill that already covers launching the app; otherwise falls back to built-in patterns per project type (CLI, server, TUI, Electron, browser-driven, library).'

const RUN_PROMPT = `# Run: Launch and Verify the Real App

Confirm that a change works in the actual running application — not only in unit tests.

## Step 1: Check for Project-Specific Instructions First

Before improvising a launch command, check for:
- A project skill or script that already knows how to run or verify this app (e.g. \`.noa/skills/\`, \`.claude/skills/\`, \`scripts/\`, \`CLAUDE.md\`, \`README.md\`, \`package.json\`, \`Makefile\`, \`pyproject.toml\`, \`Cargo.toml\`).
- If the repo already documents a build/run/E2E command, follow it.

## Step 2: Identify the Project Type and Drive It

Pick the pattern that matches what you are verifying:

1. **CLI tool**
   - Build or invoke the real entrypoint (e.g. compiled binary or \`bin/\` script) in an isolated temp dir so you do not pollute the repo or user config.
   - Exercise both happy-path and edge-case invocations; inspect stdout, stderr, exit code, and created files.
2. **HTTP / RPC / WebSocket server**
   - Start the server on an ephemeral port (e.g. \`0\` or an unused port) with a bounded timeout and log capture.
   - Wait for readiness (health endpoint or listening log line), send real requests (\`curl\` / client script) exercising the changed endpoints, and verify status codes, response payloads, and server logs.
   - Always stop the server process before finishing.
3. **Interactive TUI**
   - Drive the real terminal UI in a PTY (e.g. \`tmux\` or \`script\` / PTY harness) with realistic dimensions, send keystrokes, capture the rendered pane output, and kill the session when done.
4. **Web app / Browser-driven UI**
   - Start the dev or preview server, open it with the project's browser automation tool (Playwright / Puppeteer / browser MCP if available), trigger the real user flow, check console/network errors, and inspect screenshots or DOM state.
5. **Electron / Desktop app**
   - Use the project's Electron E2E or headless launch script if available; verify window creation, IPC/preload health, rendered state, and clean shutdown.
6. **Library / SDK**
   - Import the built package (not just internal source files) from a small throwaway consumer script in a temp directory, call the public API with realistic inputs, and remove the temp script afterward.

## Step 3: Report Evidence

End with a concise verification report containing:
- Exact command(s) run and target build/entrypoint
- Observed output / HTTP responses / exit status (or failure details if broken)
- Confirmation that any background server or PTY session started for verification was cleaned up
`

export function registerRunSkill(): void {
  registerBundledSkill({
    name: 'run',
    description: RUN_DESCRIPTION,
    userInvocable: true,
    async getPromptForCommand(args: string) {
      const parts: string[] = [RUN_PROMPT.trimEnd()]
      if (args.trim()) {
        parts.push(`## User Request\n\n${args.trim()}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
