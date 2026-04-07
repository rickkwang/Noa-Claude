const assistant = {
  name: 'assistant',
  description: 'Assistant mode',
  type: 'local-jsx',
  isHidden: true,
  load: async () => ({
    call: async () => {
      throw new Error('Assistant feature is not available in this build')
    },
  }),
}

export default assistant
