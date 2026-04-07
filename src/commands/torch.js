const torch = {
  name: 'torch',
  description: 'Torch command',
  type: 'local-jsx',
  isHidden: true,
  load: async () => ({
    call: async () => {
      throw new Error('Torch feature is not available in this build')
    },
  }),
}

export default torch
