// @ts-nocheck
import React from 'react';
import { stringWidth } from '../ink/stringWidth.js';
import { Box, Text } from '../ink.js';
import { useAppState } from '../state/AppState.js';
import type { NormalizedMessage } from '../types/message.js';
import { formatMessageTime } from '../utils/timeFormat.js';
type Props = {
  message: NormalizedMessage;
  isTranscriptMode: boolean;
};

/**
 * Assistant text messages show a timestamp in transcript mode or when
 * showMessageTimestamps is on; real user prompts only when it is on. Tagged
 * text (slash commands, system reminders) and tool results are skipped.
 */
export function shouldShowMessageTimestamp(message: NormalizedMessage, isTranscriptMode: boolean, showTimestamps: boolean): boolean {
  if (!message.timestamp) return false;
  if (message.type === "assistant") {
    return (isTranscriptMode || showTimestamps) && message.message.content.some(c => c.type === "text");
  }
  if (message.type === "user") {
    if (!showTimestamps || message.isMeta || message.isCompactSummary) return false;
    const first = message.message.content[0];
    if (first?.type === "image") return true;
    return first?.type === "text" && first.text.trim() !== "" && !first.text.trimStart().startsWith("<");
  }
  return false;
}
export function MessageTimestamp({
  message,
  isTranscriptMode
}: Props) {
  const showTimestamps = useAppState(s => s.settings.showMessageTimestamps === true);
  const timeFormat = useAppState(s => s.settings.timeFormat);
  if (!shouldShowMessageTimestamp(message, isTranscriptMode, showTimestamps)) {
    return null;
  }
  const date = new Date(message.timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const formattedTimestamp = formatMessageTime(date, timeFormat, showTimestamps);
  return <Box minWidth={stringWidth(formattedTimestamp)}>
      <Text dimColor={true}>{formattedTimestamp}</Text>
    </Box>;
}
