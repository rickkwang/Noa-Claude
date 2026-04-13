// @ts-nocheck
import type { Command } from '../../commands.js'

const cacheProbe = {
  type: 'local',
  name: 'cache-probe',
  description:
    'Probe API cache hit rate by sending identical requests and comparing cached_tokens',
  load: () => import('./cache-probe.js'),
} satisfies Command

export default cacheProbe
