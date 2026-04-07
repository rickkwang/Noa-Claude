// @ts-nocheck
export const useProactive = () => ({
  state: { kind: 'idle' },
  setContextBlocked: (_blocked: boolean) => {},
  resumeProactive: () => {},
  subscribe: () => () => {},
});
export default useProactive;
