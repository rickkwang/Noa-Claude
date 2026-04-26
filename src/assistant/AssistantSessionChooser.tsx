import React from 'react';
import { Text } from '../ink.js';
import type { OptionWithDescription } from '../components/CustomSelect/select.js';
import { Select } from '../components/CustomSelect/index.js';
import { Dialog } from '../components/design-system/Dialog.js';
import type { AssistantSession } from './sessionDiscovery.js';

type Props = {
  sessions: AssistantSession[];
  onSelect: (id: string) => void;
  onCancel: () => void;
};

function getSessionLabel(session: AssistantSession): string {
  return session.title ?? session.name ?? session.environmentName ?? `Session ${session.id.slice(0, 8)}`;
}

function getSessionDescription(session: AssistantSession): string | undefined {
  const parts = [
    session.environmentName ?? session.environmentId,
    session.cwd,
    session.updatedAt ? `updated ${session.updatedAt}` : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' • ') : undefined;
}

function toOption(session: AssistantSession): OptionWithDescription {
  return {
    label: getSessionLabel(session),
    value: session.id,
    description: getSessionDescription(session),
  };
}

export function AssistantSessionChooser({
  sessions,
  onSelect,
  onCancel,
}: Props): React.ReactNode {
  if (sessions.length === 0) {
    return (
      <Dialog title="Assistant sessions" onCancel={onCancel}>
        <Text dimColor={true}>No running assistant sessions were found.</Text>
      </Dialog>
    );
  }

  const options = sessions.map(toOption);

  return (
    <Dialog title="Assistant sessions" subtitle="Pick a running assistant session to attach to." onCancel={onCancel}>
      <Select options={options} onChange={(value: string) => onSelect(value)} />
    </Dialog>
  );
}

export default AssistantSessionChooser;
