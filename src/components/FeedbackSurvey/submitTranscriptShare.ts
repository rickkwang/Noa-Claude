// @ts-nocheck
import type { Message } from '../../types/message.js'

type TranscriptShareResult = {
  success: boolean
  transcriptId?: string
}

export type TranscriptShareTrigger =
  | 'bad_feedback_survey'
  | 'good_feedback_survey'
  | 'frustration'
  | 'memory_survey'

// Disabled for noa: previously POSTed full session transcripts (with raw
// JSONL) to api.anthropic.com/api/claude_code_shared_session_transcripts.
// Same class of leak as the old /feedback flow — neutered to never make
// the network call. Kept as a no-op so call sites and types still compile.
export async function submitTranscriptShare(
  _messages: Message[],
  _trigger: TranscriptShareTrigger,
  _appearanceId: string,
): Promise<TranscriptShareResult> {
  return { success: false }
}
