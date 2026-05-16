// @ts-nocheck
import { c as _c } from "react/compiler-runtime";
import React, { useEffect, useState } from 'react';
import { Select } from '../../components/CustomSelect/select.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { Text } from '../../ink.js';
import type { LocalJSXCommandCall, LocalJSXCommandContext } from '../../types/command.js';
import { isUsing3PServices } from '../../utils/auth.js';
import {
  applyActiveProviderProfileEnv,
  loadProviderProfiles,
  PROVIDER_TYPE_LABELS,
  setActiveProviderProfile,
  type ProviderProfile,
} from '../../utils/providerProfile.js';
import { onProviderSwitch } from '../../utils/providerSwitch.js';

type ProviderOption = {
  id: string;
  label: string;
  profile: ProviderProfile;
};

export const call: LocalJSXCommandCall = async (onDone, context) => {
  return <ProviderPicker onDone={onDone} context={context} />;
};

function ProviderPicker({
  onDone,
  context,
}: {
  onDone: (result?: string, options?: { display?: 'system' | 'user' | 'skip' }) => void;
  context: LocalJSXCommandContext;
}) {
  const $ = _c(7);
  const [profiles, setProfiles] = useState<ProviderProfile[] | null>(null);
  const [loading, setLoading] = useState(true);

  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = () => {
      onDone('Provider switch cancelled', { display: 'system' });
    };
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  const handleCancel = t0;

  useEffect(() => {
    loadProviderProfiles().then((loaded) => {
      setProfiles(loaded);
      setLoading(false);
    });
  }, []);

  let t1;
  if ($[1] !== profiles || $[2] !== onDone || $[3] !== context) {
    t1 = (profileId: string) => {
      if (!profiles) return;
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) {
        onDone('Selected provider profile not found.', { display: 'system' });
        return;
      }

      setActiveProviderProfile(profileId)
        .then(() => applyActiveProviderProfileEnv())
        .then(() => {
          onProviderSwitch(context);
          onDone(`Switched to provider ${profile.name}`, { display: 'system' });
        })
        .catch((err) => {
          onDone(`Failed to switch provider: ${err.message}`, { display: 'system' });
        });
    };
    $[1] = profiles;
    $[2] = onDone;
    $[3] = context;
    $[4] = t1;
  } else {
    t1 = $[4];
  }
  const handleSelect = t1;

  if (loading) {
    let t2;
    if ($[5] !== handleCancel) {
      t2 = (
        <Dialog title="Provider" onCancel={handleCancel} color="permission">
          <Text>Loading providers...</Text>
        </Dialog>
      );
      $[5] = handleCancel;
      $[6] = t2;
    } else {
      t2 = $[6];
    }
    return t2;
  }

  if (isUsing3PServices()) {
    return (
      <Dialog title="Provider" onCancel={handleCancel} color="permission">
        <Text>Provider profiles are unavailable while using third-party services.</Text>
        <Text dimColor>
          Unset CLAUDE_CODE_USE_BEDROCK, CLAUDE_CODE_USE_VERTEX, or CLAUDE_CODE_USE_FOUNDRY to enable profile switching.
        </Text>
      </Dialog>
    );
  }

  const activeProfile = profiles?.find((p) => p.active);

  if (!profiles || profiles.length === 0) {
    return (
      <Dialog title="Provider" onCancel={handleCancel} color="permission">
        <Text>No providers configured.</Text>
        <Text dimColor>
          Run /login to add a provider, or set provider credentials via environment variables.
        </Text>
      </Dialog>
    );
  }

  const options = profiles.map((profile) => ({
    label: `${profile.name} (${PROVIDER_TYPE_LABELS[profile.type]})${
      profile.id === activeProfile?.id ? ' [active]' : ''
    }`,
    value: profile.id,
  }));

  return (
    <Dialog title="Provider" onCancel={handleCancel} color="permission">
      <Text>Select a provider to activate:</Text>
      <Select
        options={options}
        defaultValue={activeProfile?.id}
        onChange={handleSelect}
        onCancel={handleCancel}
      />
    </Dialog>
  );
}
