// @ts-nocheck
import React from 'react';
import { stringWidth } from '../ink/stringWidth.js';
import { Box, Text } from '../ink.js';
import { useAppState } from '../state/AppState.js';
import type { NormalizedMessage } from '../types/message.js';
import { formatConfiguredClock } from '../utils/timeFormat.js';
type Props = {
  message: NormalizedMessage;
  // Transcript mode always shows the timestamp; elsewhere showMessageTimestamps decides.
  isTranscriptMode: boolean;
};
export function MessageTimestamp({
  message,
  isTranscriptMode
}: Props) {
  const showTimestamps = useAppState(s => s.settings.showMessageTimestamps === true);
  const timeFormat = useAppState(s => s.settings.timeFormat);
  const shouldShowTimestamp = (isTranscriptMode || showTimestamps) && message.timestamp && message.type === "assistant" && message.message.content.some(c => c.type === "text");
  if (!shouldShowTimestamp) {
    return null;
  }
  const date = new Date(message.timestamp);
  const formattedTimestamp = formatConfiguredClock(date, timeFormat) ?? date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
  return <Box minWidth={stringWidth(formattedTimestamp)}>
      <Text dimColor={true}>{formattedTimestamp}</Text>
    </Box>;
}
