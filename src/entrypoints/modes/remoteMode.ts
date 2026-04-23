// @ts-nocheck
import type { RemoteSessionConfig } from '../../remote/RemoteSessionManager.js';
import type { RemoteMessageContent } from '../../utils/teleport/api.js';
import { resolveRuntimeModeKind } from '../../services/runtime/modeRuntime.js';

export type RemoteModeAdapter = {
  isRemoteMode: boolean;
  sendMessage: (
    content: RemoteMessageContent,
    opts?: { uuid?: string },
  ) => Promise<boolean>;
  cancelRequest: () => void;
  disconnect: () => void;
};

export function isRemoteSessionMode(
  remoteSessionConfig: RemoteSessionConfig | undefined,
): boolean {
  return resolveRuntimeModeKind({ remoteSessionConfig }) === 'remote';
}

export function pickActiveRemoteMode(params: {
  remote: RemoteModeAdapter;
  direct: RemoteModeAdapter;
  ssh: RemoteModeAdapter;
}): RemoteModeAdapter {
  if (params.ssh.isRemoteMode) {
    return params.ssh;
  }
  if (params.direct.isRemoteMode) {
    return params.direct;
  }
  return params.remote;
}
