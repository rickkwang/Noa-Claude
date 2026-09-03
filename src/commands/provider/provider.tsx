// @ts-nocheck
import { c as _c } from "react/compiler-runtime";
import React, { useEffect, useState } from 'react';
import { Select } from '../../components/CustomSelect/select.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { Text } from '../../ink.js';
import type { LocalJSXCommandCall, LocalJSXCommandContext } from '../../types/command.js';
import {
  getConfiguredApiKeyHelper,
  isAnthropicAuthEnabled,
  isManagedOAuthContext,
  isUsing3PServices,
} from '../../utils/auth.js';
import { getGlobalConfig } from '../../utils/config.js';
import { isBareMode } from '../../utils/envUtils.js';
import {
  applyActiveProviderProfileEnv,
  deactivateProviderProfilesForNextLaunch,
  loadProviderProfiles,
  PROVIDER_TYPE_LABELS,
  refreshActiveProviderModels,
  setActiveProviderProfile,
  switchToAnthropicAccount,
  type ProviderProfile,
} from '../../utils/providerProfile.js';
import { onProviderSwitch } from '../../utils/providerSwitch.js';

// Sentinel row for "stop routing through a profile". Without it the picker only
// ever moved between third-party profiles and /login was the sole way back.
// Deliberately not labelled "use your Anthropic login": what a session falls
// back to is whatever env/settings/launcher supply, which for an account that
// never logged in is the launcher's product default, not Anthropic.
const NO_PROVIDER_VALUE = '__none__';

// Sentinel row for the stored Anthropic account, offered instead of the one
// above once there is an account to go back to. It clears the profile the same
// way, but takes effect immediately and repoints the launcher at Anthropic —
// the credentials are already in secure storage, so unlike NO_PROVIDER_VALUE
// this cannot leave the running session without a route.
const ANTHROPIC_ACCOUNT_VALUE = '__anthropic__';

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

      const announce = (text: string, applyNow = true) => {
        // display: 'skip' keeps the success string out of the model
        // context — normalizeMessagesForAPI (utils/messages.ts:2080)
        // wraps SystemLocalCommandMessage as a user message and ships
        // it to the API. Surface the success to the user via a
        // transient notification so the picker dismissal isn't silent.
        // addNotification is optional on ToolUseContext; ?. guards
        // non-REPL callers (print/SDK) where no notifier is wired.
        if (applyNow && !isBareMode()) onProviderSwitch(context);
        context.addNotification?.({
          key: `provider-switch-${profileId}`,
          text,
          priority: 'medium',
        });
        onDone(text, { display: 'skip' });
      };
      const fail = (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        onDone(`Failed to switch provider: ${message}`, { display: 'system' });
      };

      if (profileId === ANTHROPIC_ACCOUNT_VALUE) {
        switchToAnthropicAccount()
          .then(() => {
            // Read the persisted record, not getOauthAccountInfo(): the
            // switch only just cleared the routing that gate depends on.
            const email = getGlobalConfig().oauthAccount?.emailAddress;
            announce(`Switched to Anthropic${email ? ` (${email})` : ''}`);
          })
          .catch(fail);
        return;
      }

      if (profileId === NO_PROVIDER_VALUE) {
        deactivateProviderProfilesForNextLaunch()
          .then(() =>
            announce(
              'Cleared the active provider; takes effect next session',
              false,
            ),
          )
          .catch(fail);
        return;
      }

      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) {
        onDone('Selected provider profile not found.', { display: 'system' });
        return;
      }

      setActiveProviderProfile(profileId)
        .then((activated) => {
          // setActiveProviderProfile resolves to null (it does not throw) when
          // the id is gone from disk — the picker list is a snapshot taken at
          // mount. Falling through would leave the previously active profile
          // in place, re-apply it, and still report the selected one as
          // switched. Throw so the .catch below reports the failure.
          if (!activated) {
            throw new Error(`provider profile ${profile.name} no longer exists`);
          }
          return applyActiveProviderProfileEnv();
        })
        .then(() => {
          // Out of band: the switch is already complete, and /model reads the
          // refreshed list from process.env whenever it lands.
          void refreshActiveProviderModels().catch(() => {});
        })
        .then(() =>
          // --bare: the apply above is a no-op by design — credentials didn't
          // change, so skip the post-switch cascade and say the switch lands
          // next session. Judge by isBareMode(), not the apply's return
          // value: null also means "no active profile", which says nothing
          // about bare.
          announce(
            isBareMode()
              ? `Saved provider ${profile.name}; not applied under --bare (takes effect next session)`
              : `Switched to provider ${profile.name}`,
          ),
        )
        .catch(fail);
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

  // Whether there is a stored Anthropic account to return to must NOT depend
  // on getOauthAccountInfo()/isAnthropicAuthEnabled(): with a third-party
  // profile active, ANTHROPIC_BASE_URL is custom and those return false/
  // undefined — gating on them would hide this row in exactly the state it's
  // needed in (chicken-and-egg: the row is what clears that routing). Read the
  // persisted account record instead; the OAuth tokens sit in secure storage
  // regardless of current routing.
  //
  // Two states still have to opt out, both because the row could not honour
  // what it promises:
  //   --bare, where applyActiveProviderProfileEnv leaves process env alone by
  //   design, so the switch would land on disk only and "Switched to
  //   Anthropic" would overstate it;
  //   an apiKeyHelper or CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR, the two
  //   hasExternalAuthToken sources (utils/auth.ts:134) that are absent from
  //   PROVIDER_ENV_KEYS — they outlive the switch and keep forcing
  //   isAnthropicAuthEnabled() false, so the row would report success and
  //   change nothing. They only disable auth outside a managed OAuth context,
  //   so mirror that condition rather than the bare presence of either.
  // Those sessions keep the deferred NO_PROVIDER_VALUE row instead.
  const externalAuthOutlivesSwitch =
    !isManagedOAuthContext() &&
    Boolean(
      getConfiguredApiKeyHelper() ||
        process.env.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR,
    );
  const oauthAccount =
    isBareMode() || externalAuthOutlivesSwitch
      ? undefined
      : getGlobalConfig().oauthAccount;

  // An account with no profiles is not "nothing configured": that user still
  // needs the row to clear handwritten settings.env routing or the launcher's
  // product default. Checked after oauthAccount for that reason.
  if (!profiles || (profiles.length === 0 && !oauthAccount)) {
    return (
      <Dialog title="Provider" onCancel={handleCancel} color="permission">
        <Text>No providers configured.</Text>
        <Text dimColor>
          Run /login to add a provider, or set provider credentials via environment variables.
        </Text>
      </Dialog>
    );
  }

  const options = [
    ...(oauthAccount
      ? [
          {
            // emailAddress is typed string but written as '' when the profile
            // fetch returns no email (cli/handlers/auth.ts:75,88), so it cannot
            // be interpolated unguarded.
            // No active profile does not imply Anthropic is what's serving the
            // session: with zero profiles, settings.env or the launcher default
            // can still route elsewhere. isAnthropicAuthEnabled() is the only
            // thing that decides it.
            label: `Anthropic${
              oauthAccount.emailAddress ? ` (${oauthAccount.emailAddress})` : ''
            }${!activeProfile && isAnthropicAuthEnabled() ? ' [active]' : ''}`,
            value: ANTHROPIC_ACCOUNT_VALUE,
          },
        ]
      : []),
    ...profiles.map((profile) => ({
      label: `${profile.name} (${PROVIDER_TYPE_LABELS[profile.type]})${
        profile.id === activeProfile?.id ? ' [active]' : ''
      }`,
      value: profile.id,
    })),
    ...(!oauthAccount && activeProfile
      ? [{ label: 'None (clear the active provider)', value: NO_PROVIDER_VALUE }]
      : []),
  ];

  return (
    <Dialog title="Provider" onCancel={handleCancel} color="permission">
      <Text>Select a provider to activate:</Text>
      <Select
        options={options}
        defaultValue={activeProfile?.id ?? (oauthAccount ? ANTHROPIC_ACCOUNT_VALUE : undefined)}
        onChange={handleSelect}
        onCancel={handleCancel}
      />
    </Dialog>
  );
}
