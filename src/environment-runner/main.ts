import { cliError } from '../cli/exit.js'

export async function environmentRunnerMain(_args: string[]): Promise<void> {
  cliError('Environment runner is not available in this build.')
}
