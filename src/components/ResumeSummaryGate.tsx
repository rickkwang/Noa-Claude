// @ts-nocheck
import React from 'react';
import { Box, Text } from '../ink.js';
import type { LogOption } from '../types/logs.js';
import { Select } from './CustomSelect/select.js';

type Props = {
  log: LogOption;
  onContinue: () => void;
  onBack: () => void;
  /** Wrap summary text in MessageResponse for richer display. Default false. */
  useMessageResponse?: boolean;
};

export function ResumeSummaryGate({
  log,
  onContinue,
  onBack,
  useMessageResponse = false,
}: Props): React.ReactNode {
  const summary = log.summary?.trim() ?? '';
  const summaryContent = useMessageResponse
    ? <Box paddingTop={1}><Text>{summary}</Text></Box>
    : <Text>{summary}</Text>;

  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor={true}>Older large session detected.</Text>
      {summaryContent}
      <Select
        options={[
          { label: 'Continue resume', value: 'continue' },
          { label: 'Back to list', value: 'back' },
        ]}
        onChange={value => {
          if (value === 'continue') {
            onContinue();
          } else {
            onBack();
          }
        }}
        onCancel={onBack}
      />
    </Box>
  );
}