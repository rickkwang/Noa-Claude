import { spawn } from "node:child_process"
import { resolve } from "node:path"
import electron from "electron"

const cwd = resolve(import.meta.dir, "..")
const environment = process.env

let child
if (process.platform === "darwin") {
  const appBundle = resolve(electron, "../../..")
  const envArgs = ["NOA_GUI_DEV", "CLAUDE_CONFIG_DIR", "BUN_PATH"]
    .filter((name) => environment[name] !== undefined)
    .flatMap((name) => ["--env", `${name}=${environment[name]}`])
  child = spawn("open", ["-n", "-W", ...envArgs, appBundle, "--args", cwd], {
    cwd,
    env: environment,
    stdio: "inherit",
  })
} else {
  child = spawn(electron, [cwd], { cwd, env: environment, stdio: "inherit" })
}

child.on("error", (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.on("exit", (code) => {
  process.exitCode = code ?? 1
})
