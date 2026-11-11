import { spawn } from "node:child_process"
import { resolve } from "node:path"
import electron from "electron"

const cwd = resolve(import.meta.dir, "..")
const environment = { ...process.env }

// A desktop launched from a coding-agent shell must use its own saved routing.
if (environment.CLAUDECODE) {
  for (const name of Object.keys(environment)) {
    if (name.startsWith("ANTHROPIC_") || name.startsWith("CLAUDE_CODE_") || name === "CLAUDECODE" || name === "CLAUDE_EFFORT") {
      delete environment[name]
    }
  }
}

// Spawn directly so LaunchServices cannot restore the parent agent's environment.
const child = spawn(electron, [cwd], { cwd, env: environment, stdio: "inherit" })

child.on("error", (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.on("exit", (code) => {
  process.exitCode = code ?? 1
})
