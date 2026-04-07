import { cliError } from '../cli/exit.js'

export async function runDaemonWorker(kind?: string): Promise<void> {
  const suffix = kind ? ` "${kind}"` : ''
  cliError(`Daemon worker${suffix} is not available in this build.`)
}
