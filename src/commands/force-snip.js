const forceSnip = {
  name: 'force-snip',
  description: 'Force session snipping',
  type: 'local-jsx',
  isHidden: true,
  load: async () => ({
    call: async () => {
      throw new Error('Force-snip feature is not available in this build')
    },
  }),
}

export default forceSnip
