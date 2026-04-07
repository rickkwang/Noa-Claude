import { cliError } from '../cli/exit.js'

export async function selfHostedRunnerMain(_args: string[]): Promise<void> {
  cliError('Self-hosted runner is not available in this build.')
}
