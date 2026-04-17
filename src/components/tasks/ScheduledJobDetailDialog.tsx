import React from 'react';
import type { ExitState } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Text } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import {
  formatDateTime,
  type ScheduledJobListItem,
} from './backgroundTasksScheduled.js';

type Props = {
  item: ScheduledJobListItem;
  onBack: () => void;
  onClose: () => void;
  onCancel: () => void;
};

export function ScheduledJobDetailDialog({
  item,
  onBack,
  onClose,
  onCancel,
}: Props): React.ReactNode {
  useKeybindings(
    {
      'confirm:yes': onBack,
    },
    {
      context: 'Confirmation',
    },
  );

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'left') {
      e.preventDefault();
      onBack();
      return;
    }
    if (e.key === 'x') {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      onClose();
    }
  };

  const actions = [
    <KeyboardShortcutHint key="back" shortcut="←/Enter" action="back" />,
    <KeyboardShortcutHint key="cancel" shortcut="x" action="cancel" />,
    <KeyboardShortcutHint key="close" shortcut="Esc/Space" action="close" />,
  ];

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog
        title="Scheduled job details"
        subtitle={<Text dimColor>{item.id}</Text>}
        color="background"
        onCancel={onClose}
        inputGuide={(exitState: ExitState) =>
          exitState.pending ? (
            <Text>Press {exitState.keyName} again to exit</Text>
          ) : (
            <Byline>{actions}</Byline>
          )
        }
      >
        <Box flexDirection="column">
          <Text>
            <Text bold>Cron:</Text> {item.cron}
          </Text>
          <Text>
            <Text bold>Schedule:</Text> {item.humanSchedule}
          </Text>
          <Text>
            <Text bold>Next run:</Text> {formatDateTime(item.nextRunMs)}
          </Text>
          <Text>
            <Text bold>Created:</Text> {formatDateTime(item.createdAt)}
          </Text>
          <Text>
            <Text bold>Mode:</Text> {item.recurring ? 'recurring' : 'one-shot'}
          </Text>
          <Text>
            <Text bold>Scope:</Text> {item.durable ? 'durable' : 'session-only'}
          </Text>
          <Text dimColor>
            Press <Text bold>x</Text> to cancel this scheduled job.
          </Text>
          <Text bold>Prompt:</Text>
          <Text>{item.prompt}</Text>
        </Box>
      </Dialog>
    </Box>
  );
}
