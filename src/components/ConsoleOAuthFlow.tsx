// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { installOAuthTokens } from '../cli/handlers/auth.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { setClipboard } from '../ink/termio/osc.js';
import { useTerminalNotification } from '../ink/useTerminalNotification.js';
import { Box, Link, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { getSSLErrorHint } from '../services/api/errorUtils.js';
import { sendNotification } from '../services/notifier.js';
import { OAuthService } from '../services/oauth/index.js';
import { getOauthAccountInfo, validateForceLoginOrg } from '../utils/auth.js';
import { isBareMode } from '../utils/envUtils.js';
import { logError } from '../utils/log.js';
import { discoverProviderModelNames } from '../utils/model/openaiModelDiscovery.js';
import { renderModelName } from '../utils/model/model.js';
import {
  addProviderProfile,
  applyActiveProviderProfileEnv,
  loadProviderProfiles,
  setActiveProviderProfile,
  type ProviderType,
  updateProviderProfile
} from '../utils/providerProfile.js';
import { getSettings_DEPRECATED } from '../utils/settings/settings.js';
import { Select } from './CustomSelect/select.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { Spinner } from './Spinner.js';
import TextInput from './TextInput.js';
type Props = {
  onDone(result?: ConsoleOAuthFlowResult): void;
  startingMessage?: string;
  mode?: 'login' | 'setup-token';
  forceLoginMethod?: 'claudeai' | 'console';
};
export type ConsoleOAuthFlowResult = {
  type: 'oauth';
} | {
  type: 'provider-setup';
  message: string;
};
type OAuthStatus = {
  state: 'idle';
} // Initial state, waiting to select login method
| {
  state: 'platform_setup';
} // Show third-party provider setup flow
| {
  state: 'ready_to_start';
} // Flow started, waiting for browser to open
| {
  state: 'waiting_for_login';
  url: string;
} // Browser opened, waiting for user to login
| {
  state: 'creating_api_key';
} // Got access token, creating API key
| {
  state: 'about_to_retry';
  nextState: OAuthStatus;
} | {
  state: 'success';
  token?: string;
} | {
  state: 'error';
  message: string;
  toRetry?: OAuthStatus;
};
const PASTE_HERE_MSG = 'Paste code here if prompted > ';
type PlatformPreset = {
  value: string;
  name: string;
  description: string;
  type: ProviderType;
  profileName: string;
  baseUrl: string;
  model: string;
};
const PLATFORM_PRESETS: PlatformPreset[] = [{
  value: 'anthropic',
  name: 'Anthropic',
  description: 'Native Claude API (x-api-key auth)',
  type: 'anthropic',
  profileName: 'Anthropic',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-5'
}, {
  value: 'ollama',
  name: 'Ollama',
  description: 'Local or remote Ollama endpoint',
  type: 'ollama',
  profileName: 'Ollama',
  baseUrl: 'http://localhost:11434/v1',
  model: 'llama3'
}, {
  value: 'openai',
  name: 'OpenAI',
  description: 'OpenAI API with API key',
  type: 'openai',
  profileName: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o'
}, {
  value: 'github',
  name: 'GitHub Models',
  description: 'GitHub Models API endpoint',
  type: 'github',
  profileName: 'GitHub Models',
  baseUrl: 'https://models.inference.ai.dev/api',
  model: 'gpt-4o'
}, {
  value: 'codex',
  name: 'OpenAI Codex',
  description: 'OpenAI Codex endpoint',
  type: 'codex',
  profileName: 'OpenAI Codex',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o'
}, {
  value: 'kimi',
  name: 'Kimi Code',
  description: 'Kimi For Coding Anthropic-compatible endpoint',
  type: 'kimi',
  profileName: 'Kimi Code',
  baseUrl: 'https://api.kimi.com/coding',
  model: 'kimi-for-coding'
}, {
  value: 'moonshot',
  name: 'Moonshot CN',
  description: 'Kimi API China endpoint',
  type: 'moonshot',
  profileName: 'Moonshot CN',
  baseUrl: 'https://api.moonshot.cn/v1',
  model: 'kimi-k2.6'
}, {
  value: 'deepseek',
  name: 'DeepSeek',
  description: 'DeepSeek OpenAI-compatible endpoint',
  type: 'deepseek',
  profileName: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat'
}, {
  value: 'gemini',
  name: 'Google Gemini',
  description: 'Gemini OpenAI-compatible endpoint',
  type: 'gemini',
  profileName: 'Google Gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  model: 'gemini-2.5-pro'
}, {
  value: 'together',
  name: 'Together AI',
  description: 'Together chat/completions endpoint',
  type: 'together',
  profileName: 'Together AI',
  baseUrl: 'https://api.together.xyz/v1',
  model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo'
}, {
  value: 'groq',
  name: 'Groq',
  description: 'Groq OpenAI-compatible endpoint',
  type: 'groq',
  profileName: 'Groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  model: 'llama-3.3-70b-versatile'
}, {
  value: 'mistral',
  name: 'Mistral',
  description: 'Mistral OpenAI-compatible endpoint',
  type: 'mistral',
  profileName: 'Mistral',
  baseUrl: 'https://api.mistral.ai/v1',
  model: 'mistral-large-latest'
}, {
  value: 'minimax',
  name: 'MiniMax',
  description: 'MiniMax Anthropic-compatible endpoint (China)',
  type: 'minimax',
  profileName: 'MiniMax',
  baseUrl: 'https://api.minimaxi.com/anthropic',
  model: 'MiniMax-M2.7'
}, {
  value: 'glm',
  name: 'Z.AI GLM',
  description: 'Z.AI GLM Coding Plan (China)',
  type: 'glm',
  profileName: 'Z.AI GLM',
  baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
  model: 'glm-5.1'
}, {
  value: 'azure-openai',
  name: 'Azure OpenAI',
  description: 'Azure OpenAI endpoint (model=deployment name)',
  type: 'azure-openai',
  profileName: 'Azure OpenAI',
  baseUrl: 'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT',
  model: 'YOUR-DEPLOYMENT'
}, {
  value: 'openrouter',
  name: 'OpenRouter',
  description: 'OpenRouter OpenAI-compatible endpoint',
  type: 'openrouter',
  profileName: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'openrouter/auto'
}, {
  value: 'lmstudio',
  name: 'LM Studio',
  description: 'Local LM Studio endpoint',
  type: 'lmstudio',
  profileName: 'LM Studio',
  baseUrl: 'http://localhost:1234/v1',
  model: 'local-model'
}, {
  value: 'mimo',
  name: 'Xiaomi MiMo',
  description: 'Xiaomi MiMo OpenAI-compatible endpoint',
  type: 'mimo',
  profileName: 'Xiaomi MiMo',
  baseUrl: 'https://api.xiaomimimo.com/v1',
  model: 'mimo-v2.5-pro'
}];
async function activateProviderPreset(value: string, overrides?: {
  profileName?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}): Promise<{
  presetName: string;
  profileName: string;
}> {
  const preset = PLATFORM_PRESETS.find(_ => _.value === value);
  if (!preset) {
    throw new Error(`Unknown provider preset: ${value}`);
  }
  const nextProfileName = overrides?.profileName?.trim() || preset.profileName;
  const nextBaseUrl = overrides?.baseUrl?.trim() || preset.baseUrl;
  const nextModel = overrides?.model?.trim() || preset.model;
  const nextApiKey = overrides?.apiKey?.trim();
  const profiles = await loadProviderProfiles();
  const existing = profiles.find(profile => profile.name === nextProfileName);
  let profileId: string;
  if (existing) {
    await updateProviderProfile(existing.id, {
      name: nextProfileName,
      type: preset.type,
      baseUrl: nextBaseUrl,
      model: nextModel,
      apiKey: nextApiKey || undefined
    });
    profileId = existing.id;
  } else {
    const created = await addProviderProfile({
      name: nextProfileName,
      type: preset.type,
      baseUrl: nextBaseUrl,
      model: nextModel,
      apiKey: nextApiKey || undefined
    });
    profileId = created.id;
  }
  await setActiveProviderProfile(profileId);
  await applyActiveProviderProfileEnv();
  return {
    presetName: preset.name,
    profileName: nextProfileName
  };
}

type ProviderSetupWizardProps = {
  onCancel: () => void;
  onComplete: (message: string) => void;
  onError: (message: string) => void;
};
type ProviderSetupStep = 'select' | 'name' | 'baseUrl' | 'apiKey' | 'modelSelect' | 'model';
const PROVIDER_FORM_STEPS: Array<{
  key: Exclude<ProviderSetupStep, 'select' | 'modelSelect'>;
  label: string;
  placeholder: string;
  helpText: string;
}> = [{
  key: 'name',
  label: 'Provider name',
  placeholder: 'e.g. DeepSeek, MiniMax CN',
  helpText: 'A short label shown in /provider and startup setup.'
}, {
  key: 'baseUrl',
  label: 'Base URL',
  placeholder: 'e.g. https://api.deepseek.com/v1',
  helpText: 'API base URL used for this provider profile.'
}, {
  key: 'apiKey',
  label: 'API key',
  placeholder: 'Leave empty if your provider does not require one',
  helpText: 'Optional. Press Enter with empty value to skip.'
}, {
  key: 'model',
  label: 'Default model',
  placeholder: 'e.g. deepseek-chat',
  helpText: 'Model name to use when automatic discovery is unavailable.'
}];
function ProviderSetupWizard({
  onCancel,
  onComplete,
  onError
}: ProviderSetupWizardProps): React.ReactNode {
  const [step, setStep] = useState<ProviderSetupStep>('select');
  const [selectedPreset, setSelectedPreset] = useState<PlatformPreset | null>(null);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [discoveryStatus, setDiscoveryStatus] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputColumns = Math.max(24, useTerminalSize().columns - 9);
  useEffect(() => {
    setCursorOffset(0);
  }, [step]);
  const handleStepBack = () => {
    if (saving) return;
    if (step === 'select') {
      onCancel();
      return;
    }
    if (step === 'name') {
      setStep('select');
      return;
    }
    if (step === 'baseUrl') {
      setInputValue(name);
      setStep('name');
      return;
    }
    if (step === 'apiKey') {
      setInputValue(baseUrl);
      setStep('baseUrl');
      return;
    }
    if (step === 'modelSelect') {
      setInputValue(apiKey);
      setStep('apiKey');
      return;
    }
    if (step === 'model') {
      if (discoveredModels.length > 0) {
        setStep('modelSelect');
        return;
      }
      setInputValue(apiKey);
      setStep('apiKey');
      return;
    }
    setInputValue(model);
    setStep('model');
  };
  const startPresetFlow = (presetValue: string) => {
    const preset = PLATFORM_PRESETS.find(_ => _.value === presetValue);
    if (!preset) return;
    setSelectedPreset(preset);
    setName(preset.profileName);
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    setApiKey('');
    setDiscoveredModels([]);
    setDiscoveryStatus(null);
    setInputValue(preset.profileName);
    setFormError(null);
    setStep('name');
  };
  const isValidHttpUrl = (value: string): boolean => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  };
  const requiresApiKey = (preset: PlatformPreset): boolean => {
    return preset.type !== 'ollama' && preset.type !== 'lmstudio';
  };
  const isLikelyValidApiKey = (value: string): boolean => {
    const trimmed = value.trim();
    if (trimmed.length < 8) return false;
    if (/^\d+$/.test(trimmed)) return false;
    return true;
  };
  const activateSelectedProvider = (nextModel: string, nextApiKey?: string) => {
    if (!selectedPreset) return;
    setFormError(null);
    setModel(nextModel);
    setSaving(true);
    void activateProviderPreset(selectedPreset.value, {
      profileName: name,
      baseUrl,
      model: nextModel,
      apiKey: (nextApiKey ?? apiKey) || undefined
    }).then(result => {
      // Under --bare the apply above is a no-op by design — the profile is
      // persisted but the caller's env stays authoritative this session.
      onComplete(isBareMode()
        ? `✓ ${result.presetName} preset saved. Not applied under --bare; takes effect next session. Active profile: ${result.profileName}.`
        : `✓ ${result.presetName} preset is active. Active profile: ${result.profileName}.`);
    }).catch(err => {
      const message = err instanceof Error ? err.message : String(err);
      onError(`Provider setup failed: ${message}`);
    }).finally(() => {
      setSaving(false);
    });
  };
  const discoverModelsAndContinue = (nextApiKey?: string) => {
    if (!selectedPreset) return;
    setSaving(true);
    setDiscoveryStatus('Fetching available models…');
    setDiscoveredModels([]);
    void discoverProviderModelNames({
      type: selectedPreset.type,
      baseUrl,
      apiKey: nextApiKey
    }).then(names => {
      if (names.length > 0) {
        setDiscoveredModels(names);
        setDiscoveryStatus(null);
        setStep('modelSelect');
        return;
      }
      setDiscoveryStatus('Could not fetch models from this endpoint.');
      setInputValue(model || selectedPreset.model);
      setStep('model');
    }).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      setDiscoveryStatus(`Could not fetch models: ${message}`);
      setInputValue(model || selectedPreset.model);
      setStep('model');
    }).finally(() => {
      setSaving(false);
    });
  };
  const submitStep = (raw: string) => {
    if (!selectedPreset || saving) return;
    const value = raw.trim();
    if (step === 'name') {
      const next = value || selectedPreset.profileName;
      if (!next) {
        setFormError('Provider name is required.');
        return;
      }
      setFormError(null);
      setName(next);
      setInputValue(baseUrl || selectedPreset.baseUrl);
      setStep('baseUrl');
      return;
    }
    if (step === 'baseUrl') {
      const next = value || baseUrl || selectedPreset.baseUrl;
      if (!isValidHttpUrl(next)) {
        setFormError('Base URL must be a valid http(s) address.');
        return;
      }
      setFormError(null);
      setBaseUrl(next);
      setInputValue(apiKey);
      setStep('apiKey');
      return;
    }
    if (step === 'apiKey') {
      const nextApiKey = value || undefined;
      if (requiresApiKey(selectedPreset) && !nextApiKey) {
        setFormError('API key is required for this provider.');
        return;
      }
      if (nextApiKey && !isLikelyValidApiKey(nextApiKey)) {
        setFormError('API key looks invalid (too short or numeric-only).');
        return;
      }
      setFormError(null);
      setApiKey(value);
      discoverModelsAndContinue(nextApiKey);
      return;
    }
    if (step === 'model') {
      const next = value || model || selectedPreset.model;
      if (!next) {
        setFormError('Model is required.');
        return;
      }
      activateSelectedProvider(next);
    }
  };
  const modelOptions = [
    ...discoveredModels.map(name => ({
      label: <Text>{renderModelName(name)}</Text>,
      value: name
    })),
    {
      label: <Text dimColor>Enter manually</Text>,
      value: '__manual__'
    }
  ];
  const sortedPlatformPresets = [...PLATFORM_PRESETS].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const options = sortedPlatformPresets.map(preset => {
    const spacer = ' '.repeat(Math.max(1, 14 - preset.name.length));
    return {
      label: <Text>{preset.name}{spacer}<Text dimColor>{preset.description}</Text></Text>,
      value: preset.value
    };
  });
  return <Box flexDirection="column" gap={1}>
      {step === 'select' ? <Box flexDirection="column" gap={1}>
          <Text bold={true}>Set up provider</Text>
          <Text>Pick a preset.</Text>
          <Box>
            <Select options={[...options, {
            label: <Text dimColor>Back to login options</Text>,
            value: '__back__'
          }]} onChange={value => {
            if (value === '__back__') {
              onCancel();
              return;
            }
            startPresetFlow(String(value));
          }} onCancel={onCancel} />
          </Box>
          <Text dimColor={true}>China endpoints included: DeepSeek, Kimi Code, MiniMax, Moonshot CN, Z.AI GLM.</Text>
        </Box> : step === 'modelSelect' ? <Box flexDirection="column" gap={1}>
          <Text color="remember" bold={true}>Select model</Text>
          <Text dimColor={true}>Fetched from {selectedPreset?.name} endpoint.</Text>
          <Box>
            <Select options={modelOptions} onChange={value => {
            if (value === '__manual__') {
              setInputValue(model || selectedPreset?.model || '');
              setStep('model');
              return;
            }
            activateSelectedProvider(String(value));
          }} onCancel={handleStepBack} />
          </Box>
        </Box> : <Box flexDirection="column" gap={1}>
          <Text color="remember" bold={true}>Create provider profile</Text>
          <Text dimColor={true}>{PROVIDER_FORM_STEPS.find(_ => _.key === step)?.helpText ?? ''}</Text>
          <Text dimColor={true}>Provider type: {selectedPreset?.type === 'anthropic' || selectedPreset?.type === 'kimi' || selectedPreset?.type === 'minimax' ? 'Anthropic-compatible API' : 'OpenAI-compatible API'}</Text>
          <Text dimColor={true}>Step {step === 'name' ? '1' : step === 'baseUrl' ? '2' : step === 'apiKey' ? '3' : '4'} of 4: {PROVIDER_FORM_STEPS.find(_ => _.key === step)?.label ?? ''}</Text>
          <Box>
            <Text>&gt; </Text>
            <TextInput value={inputValue} onChange={setInputValue} onSubmit={submitStep} onExit={handleStepBack} focus={true} showCursor={true} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} columns={inputColumns} placeholder={PROVIDER_FORM_STEPS.find(_ => _.key === step)?.placeholder} mask={step === 'apiKey' ? '*' : undefined} />
          </Box>
          {formError ? <Text color="error">{formError}</Text> : null}
          {discoveryStatus ? <Text dimColor={true}>{discoveryStatus}</Text> : null}
          <Text dimColor={true}>Press Enter to continue. Press Esc to go back.</Text>
        </Box>}
      {saving && <Box>
          <Spinner />
          <Text>{discoveryStatus === 'Fetching available models…' ? 'Fetching available models…' : 'Saving provider profile…'}</Text>
        </Box>}
    </Box>;
}
export function ConsoleOAuthFlow({
  onDone,
  startingMessage,
  mode = 'login',
  forceLoginMethod: forceLoginMethodProp
}: Props): React.ReactNode {
  const settings = getSettings_DEPRECATED() || {};
  const forceLoginMethod = forceLoginMethodProp ?? settings.forceLoginMethod;
  const orgUUID = settings.forceLoginOrgUUID;
  const forcedMethodMessage = forceLoginMethod === 'claudeai' ? 'Login method pre-selected: Subscription Plan (Claude Pro/Max)' : forceLoginMethod === 'console' ? 'Login method pre-selected: API Usage Billing (Anthropic Console)' : null;
  const terminal = useTerminalNotification();
  const [oauthStatus, setOAuthStatus] = useState<OAuthStatus>(() => {
    if (mode === 'setup-token') {
      return {
        state: 'ready_to_start'
      };
    }
    if (forceLoginMethod === 'claudeai' || forceLoginMethod === 'console') {
      return {
        state: 'ready_to_start'
      };
    }
    return {
      state: 'idle'
    };
  });
  const [pastedCode, setPastedCode] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);
  const [oauthService] = useState(() => new OAuthService());
  const [loginWithClaudeAi, setLoginWithClaudeAi] = useState(() => {
    // Use Claude AI auth for setup-token mode to support user:inference scope
    return mode === 'setup-token' || forceLoginMethod === 'claudeai';
  });
  // After a few seconds we suggest the user to copy/paste url if the
  // browser did not open automatically. In this flow we expect the user to
  // copy the code from the browser and paste it in the terminal
  const [showPastePrompt, setShowPastePrompt] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const textInputColumns = useTerminalSize().columns - PASTE_HERE_MSG.length - 1;

  // Log forced login method on mount
  useEffect(() => {
    if (forceLoginMethod === 'claudeai') {
      logEvent('tengu_oauth_claudeai_forced', {});
    } else if (forceLoginMethod === 'console') {
      logEvent('tengu_oauth_console_forced', {});
    }
  }, [forceLoginMethod]);

  // Retry logic
  useEffect(() => {
    if (oauthStatus.state === 'about_to_retry') {
      const timer = setTimeout(setOAuthStatus, 1000, oauthStatus.nextState);
      return () => clearTimeout(timer);
    }
  }, [oauthStatus]);

  // Handle Enter to continue on success state
  useKeybinding('confirm:yes', () => {
    logEvent('tengu_oauth_success', {
      loginWithClaudeAi
    });
    onDone({
      type: 'oauth'
    });
  }, {
    context: 'Confirmation',
    isActive: oauthStatus.state === 'success' && mode !== 'setup-token'
  });

  // Handle Enter to retry on error state
  useKeybinding('confirm:yes', () => {
    if (oauthStatus.state === 'error' && oauthStatus.toRetry) {
      setPastedCode('');
      setOAuthStatus({
        state: 'about_to_retry',
        nextState: oauthStatus.toRetry
      });
    }
  }, {
    context: 'Confirmation',
    isActive: oauthStatus.state === 'error' && !!oauthStatus.toRetry
  });
  useEffect(() => {
    if (pastedCode === 'c' && oauthStatus.state === 'waiting_for_login' && showPastePrompt && !urlCopied) {
      void setClipboard(oauthStatus.url).then(raw => {
        if (raw) process.stdout.write(raw);
        setUrlCopied(true);
        setTimeout(setUrlCopied, 2000, false);
      });
      setPastedCode('');
    }
  }, [pastedCode, oauthStatus, showPastePrompt, urlCopied]);
  async function handleSubmitCode(value: string, url: string) {
    try {
      // Expecting format "authorizationCode#state" from the authorization callback URL
      const [authorizationCode, state] = value.split('#');
      if (!authorizationCode || !state) {
        setOAuthStatus({
          state: 'error',
          message: 'Invalid code. Please make sure the full code was copied',
          toRetry: {
            state: 'waiting_for_login',
            url
          }
        });
        return;
      }

      // Track which path the user is taking (manual code entry)
      logEvent('tengu_oauth_manual_entry', {});
      oauthService.handleManualAuthCodeInput({
        authorizationCode,
        state
      });
    } catch (err: unknown) {
      logError(err);
      setOAuthStatus({
        state: 'error',
        message: (err as Error).message,
        toRetry: {
          state: 'waiting_for_login',
          url
        }
      });
    }
  }
  const startOAuth = useCallback(async () => {
    try {
      logEvent('tengu_oauth_flow_start', {
        loginWithClaudeAi
      });
      const result = await oauthService.startOAuthFlow(async url_0 => {
        setOAuthStatus({
          state: 'waiting_for_login',
          url: url_0
        });
        setTimeout(setShowPastePrompt, 3000, true);
      }, {
        loginWithClaudeAi,
        inferenceOnly: mode === 'setup-token',
        expiresIn: mode === 'setup-token' ? 365 * 24 * 60 * 60 : undefined,
        // 1 year for setup-token
        orgUUID
      }).catch(err_1 => {
        const isTokenExchangeError = err_1.message.includes('Token exchange failed');
        // Enterprise TLS proxies (Zscaler et al.) intercept the token
        // exchange POST and cause cryptic SSL errors. Surface an
        // actionable hint so the user isn't stuck in a login loop.
        const sslHint_0 = getSSLErrorHint(err_1);
        setOAuthStatus({
          state: 'error',
          message: sslHint_0 ?? (isTokenExchangeError ? 'Failed to exchange authorization code for access token. Please try again.' : err_1.message),
          toRetry: mode === 'setup-token' ? {
            state: 'ready_to_start'
          } : {
            state: 'idle'
          }
        });
        logEvent('tengu_oauth_token_exchange_error', {
          error: err_1.message,
          ssl_error: sslHint_0 !== null
        });
        throw err_1;
      });
      if (mode === 'setup-token') {
        // For setup-token mode, return the OAuth access token directly (it can be used as an API key)
        // Don't save to keychain - the token is displayed for manual use with CLAUDE_CODE_OAUTH_TOKEN
        setOAuthStatus({
          state: 'success',
          token: result.accessToken
        });
      } else {
        await installOAuthTokens(result);
        const orgResult = await validateForceLoginOrg();
        if (!orgResult.valid) {
          throw new Error(orgResult.message);
        }
        setOAuthStatus({
          state: 'success'
        });
        void sendNotification({
          message: 'Noa Claude login successful',
          notificationType: 'auth_success'
        }, terminal);
      }
    } catch (err_0) {
      const errorMessage = (err_0 as Error).message;
      const sslHint = getSSLErrorHint(err_0);
      setOAuthStatus({
        state: 'error',
        message: sslHint ?? errorMessage,
        toRetry: {
          state: mode === 'setup-token' ? 'ready_to_start' : 'idle'
        }
      });
      logEvent('tengu_oauth_error', {
        error: errorMessage as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ssl_error: sslHint !== null
      });
    }
  }, [oauthService, setShowPastePrompt, loginWithClaudeAi, mode, orgUUID]);
  const pendingOAuthStartRef = useRef(false);
  useEffect(() => {
    if (oauthStatus.state === 'ready_to_start' && !pendingOAuthStartRef.current) {
      pendingOAuthStartRef.current = true;
      process.nextTick((startOAuth_0: () => Promise<void>, pendingOAuthStartRef_0: React.MutableRefObject<boolean>) => {
        void startOAuth_0();
        pendingOAuthStartRef_0.current = false;
      }, startOAuth, pendingOAuthStartRef);
    }
  }, [oauthStatus.state, startOAuth]);

  // Auto-exit for setup-token mode
  useEffect(() => {
    if (mode === 'setup-token' && oauthStatus.state === 'success') {
      // Delay to ensure static content is fully rendered before exiting
      const timer_0 = setTimeout((loginWithClaudeAi_0, onDone_0) => {
        logEvent('tengu_oauth_success', {
          loginWithClaudeAi: loginWithClaudeAi_0
        });
        // Don't clear terminal so the token remains visible
        onDone_0({
          type: 'oauth'
        });
      }, 500, loginWithClaudeAi, onDone);
      return () => clearTimeout(timer_0);
    }
  }, [mode, oauthStatus, loginWithClaudeAi, onDone]);

  // Cleanup OAuth service when component unmounts
  useEffect(() => {
    return () => {
      oauthService.cleanup();
    };
  }, [oauthService]);
  const handleProviderSetupComplete = useCallback((message: string) => {
    onDone({
      type: 'provider-setup',
      message
    });
  }, [onDone]);
  return <Box flexDirection="column" gap={1}>
      {oauthStatus.state === 'waiting_for_login' && showPastePrompt && <Box flexDirection="column" key="urlToCopy" gap={1} paddingBottom={1}>
          <Box paddingX={1}>
            <Text dimColor>
              Browser didn&apos;t open? Use the url below to sign in{' '}
            </Text>
            {urlCopied ? <Text color="success">(Copied!)</Text> : <Text dimColor>
                <KeyboardShortcutHint shortcut="c" action="copy" parens />
              </Text>}
          </Box>
          <Link url={oauthStatus.url}>
            <Text dimColor>{oauthStatus.url}</Text>
          </Link>
        </Box>}
      {mode === 'setup-token' && oauthStatus.state === 'success' && oauthStatus.token && <Box key="tokenOutput" flexDirection="column" gap={1} paddingTop={1}>
            <Text color="success">
              ✓ Long-lived authentication token created successfully!
            </Text>
            <Box flexDirection="column" gap={1}>
              <Text>Your OAuth token (valid for 1 year):</Text>
              <Text color="warning">{oauthStatus.token}</Text>
              <Text dimColor>
                Store this token securely. You won&apos;t be able to see it
                again.
              </Text>
              <Text dimColor>
                Use this token by setting: export
                CLAUDE_CODE_OAUTH_TOKEN=&lt;token&gt;
              </Text>
            </Box>
          </Box>}
      <Box paddingLeft={1} flexDirection="column" gap={1}>
        <OAuthStatusMessage oauthStatus={oauthStatus} mode={mode} startingMessage={startingMessage} forcedMethodMessage={forcedMethodMessage} showPastePrompt={showPastePrompt} pastedCode={pastedCode} setPastedCode={setPastedCode} cursorOffset={cursorOffset} setCursorOffset={setCursorOffset} textInputColumns={textInputColumns} handleSubmitCode={handleSubmitCode} setOAuthStatus={setOAuthStatus} setLoginWithClaudeAi={setLoginWithClaudeAi} onProviderSetupComplete={handleProviderSetupComplete} />
      </Box>
    </Box>;
}
type OAuthStatusMessageProps = {
  oauthStatus: OAuthStatus;
  mode: 'login' | 'setup-token';
  startingMessage: string | undefined;
  forcedMethodMessage: string | null;
  showPastePrompt: boolean;
  pastedCode: string;
  setPastedCode: (value: string) => void;
  cursorOffset: number;
  setCursorOffset: (offset: number) => void;
  textInputColumns: number;
  handleSubmitCode: (value: string, url: string) => void;
  setOAuthStatus: (status: OAuthStatus) => void;
  setLoginWithClaudeAi: (value: boolean) => void;
  onProviderSetupComplete: (message: string) => void;
};
function OAuthStatusMessage({
  oauthStatus,
  mode,
  startingMessage,
  forcedMethodMessage,
  showPastePrompt,
  pastedCode,
  setPastedCode,
  cursorOffset,
  setCursorOffset,
  textInputColumns,
  handleSubmitCode,
  setOAuthStatus,
  setLoginWithClaudeAi,
  onProviderSetupComplete
}: OAuthStatusMessageProps): React.ReactNode {
  switch (oauthStatus.state) {
    case 'idle': {
      const promptText = startingMessage ?? 'Noa Claude can be used with your Claude subscription or billed based on API usage through your Console account.';
      const loginOptions = [{
        label: <Text>Claude account with subscription · <Text dimColor={true}>Pro, Max, Team, or Enterprise</Text></Text>,
        value: 'claudeai' as const
      }, {
        label: <Text>Anthropic Console account · <Text dimColor={true}>API usage billing</Text></Text>,
        value: 'console' as const
      }, {
        label: <Text>3rd-party platform · <Text dimColor={true}>OpenAI, Gemini, Bedrock, Ollama, Kimi, DeepSeek, GLM, MiniMax, and more</Text></Text>,
        value: 'platform' as const
      }];
      return <Box flexDirection="column" gap={1} marginTop={1}>
          <Text bold={true}>{promptText}</Text>
          <Text>Select login method:</Text>
          <Box>
            <Select options={loginOptions} layout="compact-vertical" onChange={value => {
            if (value === 'platform') {
              logEvent('tengu_oauth_platform_selected', {});
              setOAuthStatus({
                state: 'platform_setup'
              });
              return;
            }
            setOAuthStatus({
              state: 'ready_to_start'
            });
            if (value === 'claudeai') {
              logEvent('tengu_oauth_claudeai_selected', {});
              setLoginWithClaudeAi(true);
            } else {
              logEvent('tengu_oauth_console_selected', {});
              setLoginWithClaudeAi(false);
            }
          }} />
          </Box>
        </Box>;
    }
    case 'platform_setup':
      return <ProviderSetupWizard onCancel={() => {
        setOAuthStatus({
          state: 'idle'
        });
      }} onComplete={onProviderSetupComplete} onError={message => {
        setOAuthStatus({
          state: 'error',
          message,
          toRetry: {
            state: 'platform_setup'
          }
        });
      }} />;
    case 'waiting_for_login':
      return <Box flexDirection="column" gap={1}>
          {forcedMethodMessage ? <Box><Text dimColor={true}>{forcedMethodMessage}</Text></Box> : null}
          {!showPastePrompt ? <Box><Spinner /><Text>Opening browser to sign in…</Text></Box> : null}
          {showPastePrompt ? <Box><Text>{PASTE_HERE_MSG}</Text><TextInput value={pastedCode} onChange={setPastedCode} onSubmit={value => handleSubmitCode(value, oauthStatus.url)} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} columns={textInputColumns} mask="*" /></Box> : null}
        </Box>;
    case 'creating_api_key':
      return <Box flexDirection="column" gap={1}><Box><Spinner /><Text>Creating API key for Noa Claude…</Text></Box></Box>;
    case 'about_to_retry':
      return <Box flexDirection="column" gap={1}><Text color="permission">Retrying…</Text></Box>;
    case 'success':
      return <Box flexDirection="column">
          {mode === 'setup-token' && oauthStatus.token ? null : <>
              {getOauthAccountInfo()?.emailAddress ? <Text dimColor={true}>Logged in as <Text>{getOauthAccountInfo()?.emailAddress}</Text></Text> : null}
              <Text color="success">Login successful. Press <Text bold={true}>Enter</Text> to continue…</Text>
            </>}
        </Box>;
    case 'error':
      return <Box flexDirection="column" gap={1}>
          <Text color="error">OAuth error: {oauthStatus.message}</Text>
          {oauthStatus.toRetry ? <Box marginTop={1}>
              <Text color="permission">Press <Text bold={true}>Enter</Text> to retry.</Text>
            </Box> : null}
        </Box>;
    default:
      return null;
  }
}
