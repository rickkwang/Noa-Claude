import type { LocalCommandCall } from '../../types/command.js'
import { getBgJobShort } from '../../utils/background/bgJob.js'
import { patchJob } from '../../utils/background/jobs.js'
import { gracefulShutdown } from '../../utils/gracefulShutdown.js'

/** End this background session. The agents view lists it as stopped; opening it again resumes the transcript. */
export const call: LocalCommandCall = async () => {
  const short = getBgJobShort()
  if (short) await patchJob(short, { stopRequested: true }).catch(() => null)
  void gracefulShutdown(0, 'prompt_input_exit')
  return { type: 'text', value: 'Stopping this background session…' }
}
