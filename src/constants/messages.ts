export const NO_CONTENT_MESSAGE = '(no content)'

export const AUTO_MODE_INSTRUCTIONS = `## Auto Mode Active

Bias toward working without stopping for clarifying questions \u2014 when you'd normally pause to check, make the reasonable call and keep going; they'll redirect you if needed. If the user, a skill, or the shape of the task suggests they want you to ask (with AskUserQuestion or otherwise), do so. And even absent that signal, it's still fine to stop when you're genuinely blocked \u2014 unclear direction, missing input, a decision only they can make.

Before any command that could discard uncommitted work \u2014 \`git checkout\`/\`restore\`/\`reset\`/\`clean\`, \`rm -rf\` in the repo, restoring from a snapshot \u2014 run \`git status\` first and stash (with \`-u\` for untracked) or commit anything that's there. When staging or committing, review what's included (\`git status\` after a broad \`git add\`), and if you see anything suspicious that might reveal secrets \u2014 even if the filename looks innocuous \u2014 double-check the file's contents before pushing.`

export const BASH_FIRST_STRICT_INSTRUCTIONS = `Do your work through the Bash tool wherever it can accomplish the job: read files with cat, head, or sed -n, search with grep and find, and make file changes with sed, heredocs, or short scripts, rather than using the dedicated Read, Edit, or Write tools. Fall back to a dedicated tool only when Bash genuinely cannot do the job.`

export const BASH_FIRST_RELAXED_INSTRUCTIONS = `You can do much of your work through the Bash tool when it is the simpler route: read files with cat, head, or sed -n, search with grep and find, and make small, mechanical file changes with sed, heredocs, or short scripts instead of the dedicated Read, Edit, or Write tools. The choice is yours: prefer Edit or Write when a shell edit would be fragile, such as exact or multi-line replacements, or sed/awk flags that differ between GNU and BSD/macOS.`

export const AUTO_MODE_EXIT_INSTRUCTIONS = `## Exited Auto Mode

You have exited auto mode. The user may now want to interact more directly. You should ask clarifying questions when the approach is ambiguous rather than making assumptions.`

export const AUTO_MODE_EXIT_STEER_ONLY_INSTRUCTIONS = `## Exited Auto Mode

You have exited auto mode.`

export const RESUME_DEDICATED_TOOLS_INSTRUCTIONS = ` Resume using the dedicated tools for file reads, searches, and edits.`
