// @ts-nocheck
import { execa } from 'execa'
import {
  getMacOsKeychainStorageServiceName,
  getUsername,
  KEYCHAIN_BLOCKING_EXEC_TIMEOUT_MS,
  SEC_ERR_ITEM_NOT_FOUND,
} from 'src/utils/secureStorage/macOsKeychainHelpers.js'

export async function maybeRemoveApiKeyFromMacOSKeychainThrows(): Promise<void> {
  if (process.platform === 'darwin') {
    const storageServiceName = getMacOsKeychainStorageServiceName()
    // argv + getUsername(), to match the account saveApiKey() writes under.
    // A shell `-a $USER` expands the raw environment variable, so once
    // getUsername() sanitizes an exotic $USER the two disagree and this
    // delete permanently targets an account that holds nothing — leaving the
    // real entry in the keychain after /logout, silently (the only caller,
    // maybeRemoveApiKeyFromMacOSKeychain, swallows the throw into logError).
    const result = await execa(
      'security',
      ['delete-generic-password', '-a', getUsername(), '-s', storageServiceName],
      // removeApiKey() awaits this on the /logout path, so an unbounded call
      // hangs logout outright on a wedged keychain. Same 10s leash as the
      // other delete.
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        reject: false,
        timeout: KEYCHAIN_BLOCKING_EXEC_TIMEOUT_MS,
      },
    )
    // 44 = nothing to delete, which is the state the caller asked for. Treating
    // it as a failure made every first-time saveApiKey() log a bogus error.
    if (
      result.exitCode !== 0 &&
      result.exitCode !== SEC_ERR_ITEM_NOT_FOUND
    ) {
      throw new Error('Failed to delete keychain entry')
    }
  }
}

export function normalizeApiKeyForConfig(apiKey: string): string {
  return apiKey.slice(-20)
}
