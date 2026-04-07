import { cliError } from '../exit.js'

export async function templatesMain(_args: string[]): Promise<void> {
  cliError('Template jobs are not available in this build.')
}
