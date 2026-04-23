// @ts-nocheck
import type { RemoteSessionConfig } from '../../remote/RemoteSessionManager.js';
import type { DirectConnectConfig } from '../../server/directConnectManager.js';
import type { SSHSession } from '../../ssh/createSSHSession.js';

export type RuntimeModeKind = 'interactive' | 'remote' | 'direct' | 'ssh';

export function resolveRuntimeModeKind(params: {
  remoteSessionConfig?: RemoteSessionConfig;
  directConnectConfig?: DirectConnectConfig;
  sshSession?: SSHSession;
}): RuntimeModeKind {
  if (params.sshSession) {
    return 'ssh';
  }
  if (params.directConnectConfig) {
    return 'direct';
  }
  if (params.remoteSessionConfig) {
    return 'remote';
  }
  return 'interactive';
}
