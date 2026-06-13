// @ts-nocheck
import { isInBundledMode } from 'src/utils/bundledMode.js';
import { getCurrentInstallationType } from 'src/utils/doctorDiagnostic.js';
import { NOA_CURL_INSTALL_COMMAND } from 'src/utils/distribution.js';
import { isEnvTruthy } from 'src/utils/envUtils.js';
import { useStartupNotification } from './useStartupNotification.js';
const NPM_DEPRECATION_MESSAGE =
  `Noa Claude no longer supports npm-based installs or updates. Reinstall with \`${NOA_CURL_INSTALL_COMMAND}\`.`;
export function useNpmDeprecationNotification() {
  useStartupNotification(_temp);
}
async function _temp() {
  if (isInBundledMode() || isEnvTruthy(process.env.DISABLE_INSTALLATION_CHECKS)) {
    return null;
  }
  const installationType = await getCurrentInstallationType();
  if (installationType === "development") {
    return null;
  }
  if (installationType !== "npm-local" && installationType !== "npm-global") {
    return null;
  }
  return {
    timeoutMs: 15000,
    key: "npm-deprecation-warning",
    text: NPM_DEPRECATION_MESSAGE,
    color: "warning",
    priority: "high"
  };
}
