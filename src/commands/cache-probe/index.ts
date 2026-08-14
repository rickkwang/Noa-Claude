// @ts-nocheck
import type { Command } from '../../commands.js'

const cacheProbe = {
  type: 'local',
  name: 'cache-probe',
  description:
    'Probe API cache hit rate by sending identical requests and comparing cached_tokens',
  // Sends two real, billed messages.create calls. Kept out of the suggestion
  // list so it is not run by accident; typing /cache-probe still invokes it.
  isHidden: true,
  load: () => import('./cache-probe.js'),
} satisfies Command

export default cacheProbe
