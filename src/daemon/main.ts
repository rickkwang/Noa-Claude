import { cliError } from '../cli/exit.js'

export async function daemonMain(_args: string[]): Promise<void> {
  cliError('Daemon mode is not available in this build.')
}
