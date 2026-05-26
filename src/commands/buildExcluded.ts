export const BUILD_EXCLUDED_ERROR_CONTRACTS = {
  proactive: {
    errorId: 'E_BUILD_EXCLUDED_PROACTIVE',
    message: 'Proactive mode is not available in this build',
  },
  peers: {
    errorId: 'E_BUILD_EXCLUDED_PEERS',
    message: 'Peers feature is not available in this build',
  },
  'agents-platform': {
    errorId: 'E_BUILD_EXCLUDED_AGENTS_PLATFORM',
    message: 'Agents platform is not available in this build',
  },
  'remote-control': {
    errorId: 'E_BUILD_EXCLUDED_REMOTE_CONTROL',
    message: 'Remote control server is not available in this build',
  },
  torch: {
    errorId: 'E_BUILD_EXCLUDED_TORCH',
    message: 'Torch feature is not available in this build',
  },
  'force-snip': {
    errorId: 'E_BUILD_EXCLUDED_FORCE_SNIP',
    message: 'Force-snip feature is not available in this build',
  },
  'subscribe-pr': {
    errorId: 'E_BUILD_EXCLUDED_SUBSCRIBE_PR',
    message: 'Subscribe-PR feature is not available in this build',
  },
} as const
