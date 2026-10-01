// Inert stand-ins: assistant-mode transcript segments are absent from this
// fork, but KAIROS still builds and compact.ts calls both under that flag.
export const flushOnDateChange = () => {};
export const writeSessionTranscriptSegment = async (
  ..._args: unknown[]
): Promise<void> => {};
