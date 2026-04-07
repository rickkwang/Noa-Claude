const subscribePr = {
  name: 'subscribe-pr',
  description: 'Subscribe to PR notifications',
  type: 'local-jsx',
  isHidden: true,
  load: async () => ({
    call: async () => {
      throw new Error('Subscribe-PR feature is not available in this build')
    },
  }),
}

export default subscribePr
