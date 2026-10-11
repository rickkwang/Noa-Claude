import { execa } from 'execa'
import { logError } from './log.js'
import {
  getMacOsKeychainStorageServiceName,
  getUsername,
  SEC_ERR_ITEM_NOT_FOUND,
} from './secureStorage/macOsKeychainHelpers.js'

// Provider API keys live in macOS keychain items, so provider-profiles.json
// carries no plaintext secrets. Other platforms, test runs, and runs with
// NOA_CLAUDE_PROVIDER_KEYCHAIN=0 keep the keys in the 0600 profiles file. The
// keychain path has no automated test coverage; it was verified with scripts
// against a temp config dir. Keychain entries are not cleared while the
// keychain is off, so a key cleared in that time comes back when it is switched
// on again: re-enter it in /provider first.
export const providerKeychainSupported =
  process.platform === 'darwin' &&
  process.env.NODE_ENV !== 'test' &&
  process.env.NOA_CLAUDE_PROVIDER_KEYCHAIN !== '0'

const EXEC_TIMEOUT_MS = 10_000
// `security -i` reads one line of at most 4096 bytes (see macOsKeychainStorage.ts).
// Keys go in as hex, so each chunk's JSON gets half of what the command prefix leaves.
const MAX_CHUNK_JSON_BYTES = Math.floor((4096 - 64 - 200) / 2)

export type ProviderApiKeys = Record<string, string>

type Generation = { generation: number; chunks: number }
// The pointer names the live generation. Its write is the only commit point:
// a save lands whole or not at all. `stale` is the generation it replaced,
// kept so a failed cleanup is retried by the next save.
type Pointer = Generation & { stale?: Generation }

export type ProviderKeyCommit = { previous?: Pointer; next: Pointer }

function pointerService(): string {
  return getMacOsKeychainStorageServiceName('-provider-api-keys')
}

function chunkService(generation: number, index: number): string {
  return getMacOsKeychainStorageServiceName(
    `-provider-api-keys-g${generation}-${index}`,
  )
}

async function securityRead(service: string): Promise<string | undefined> {
  const result = await execa(
    'security',
    ['find-generic-password', '-a', getUsername(), '-s', service, '-w'],
    { reject: false, timeout: EXEC_TIMEOUT_MS },
  )
  if (result.exitCode === SEC_ERR_ITEM_NOT_FOUND) return undefined
  if (result.exitCode !== 0) {
    throw new Error(
      `keychain read failed (exit ${result.exitCode ?? 'none'}${result.timedOut ? ', timed out' : ''})`,
    )
  }
  return result.stdout
}

async function securityWrite(service: string, value: string): Promise<void> {
  // Hex keeps quotes and backslashes out of the stdin line; -i keeps the value out of argv.
  const hex = Buffer.from(value, 'utf8').toString('hex')
  if (hex.length > 4096 - 64 - 200) {
    throw new Error('provider API keys are too large for one keychain item')
  }
  const result = await execa('security', ['-i'], {
    input: `add-generic-password -U -a "${getUsername()}" -s "${service}" -X ${hex}\n`,
    reject: false,
    timeout: EXEC_TIMEOUT_MS,
  })
  if (result.exitCode !== 0) {
    throw new Error(`keychain write failed (exit ${result.exitCode ?? 'none'})`)
  }
}

/** Deleting a missing item is not an error. */
async function securityDelete(service: string): Promise<void> {
  const result = await execa(
    'security',
    ['delete-generic-password', '-a', getUsername(), '-s', service],
    { reject: false, timeout: EXEC_TIMEOUT_MS },
  )
  if (result.exitCode !== 0 && result.exitCode !== SEC_ERR_ITEM_NOT_FOUND) {
    throw new Error(
      `keychain delete failed (exit ${result.exitCode ?? 'none'}${result.timedOut ? ', timed out' : ''})`,
    )
  }
}

// Parse errors can echo the input, which here is a key: report without it.
function parseStored<T>(raw: string, what: string): T {
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`keychain ${what} is not valid provider key data`)
  }
}

async function readPointer(): Promise<Pointer | undefined> {
  const raw = await securityRead(pointerService())
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    // Nothing recoverable hangs off a corrupt pointer. Treat it as empty so
    // the next save overwrites it instead of failing forever. Saves that leave
    // keys unchanged do not rewrite it, so it stays corrupt until a key changes.
    logError(
      new Error('provider key pointer is corrupt; it will be replaced on the next save'),
    )
    return undefined
  }
}

async function deleteGeneration(generation: Generation): Promise<void> {
  for (let index = 0; index < generation.chunks; index++) {
    await securityDelete(chunkService(generation.generation, index))
  }
}

function splitKeys(keys: ProviderApiKeys): ProviderApiKeys[] {
  const chunks: ProviderApiKeys[] = []
  let current: ProviderApiKeys = {}
  for (const [id, key] of Object.entries(keys)) {
    const alone = { [id]: key }
    if (Buffer.byteLength(JSON.stringify(alone)) > MAX_CHUNK_JSON_BYTES) {
      throw new Error('provider API key is too long for keychain storage')
    }
    const merged = { ...current, [id]: key }
    if (Buffer.byteLength(JSON.stringify(merged)) > MAX_CHUNK_JSON_BYTES) {
      chunks.push(current)
      current = alone
    } else {
      current = merged
    }
  }
  if (Object.keys(current).length > 0) chunks.push(current)
  return chunks
}

/** Throws on keychain failure, so a caller never treats an unreadable key as missing. */
export async function readProviderApiKeys(): Promise<ProviderApiKeys> {
  // Loads run without the profile lock, so a save can retire the generation
  // read here; re-reading the pointer finds the one that replaced it.
  for (let attempt = 0; ; attempt++) {
    const pointer = await readPointer()
    if (!pointer) return {}
    const keys: ProviderApiKeys = {}
    let missing = false
    for (let index = 0; index < pointer.chunks && !missing; index++) {
      const raw = await securityRead(chunkService(pointer.generation, index))
      if (raw === undefined) missing = true
      else Object.assign(keys, parseStored(raw, 'chunk'))
    }
    if (!missing) return keys
    if (attempt >= 2) {
      throw new Error('provider API key chunks are missing from the keychain')
    }
  }
}

export function sameApiKeys(a: ProviderApiKeys, b: ProviderApiKeys): boolean {
  const ids = Object.keys(a)
  return (
    ids.length === Object.keys(b).length && ids.every(id => a[id] === b[id])
  )
}

/**
 * Writes `keys` as a new generation and points the keychain at it. Verifies
 * the read-back; on any failure restores the previous pointer and throws.
 */
export async function commitProviderApiKeys(
  keys: ProviderApiKeys,
): Promise<ProviderKeyCommit> {
  const previous = await readPointer()
  if (previous?.stale) await deleteGeneration(previous.stale)

  const chunks = splitKeys(keys)
  const generation = (previous?.generation ?? 0) + 1
  for (const [index, chunk] of chunks.entries()) {
    await securityWrite(
      chunkService(generation, index),
      JSON.stringify(chunk),
    )
  }
  const next: Pointer = {
    generation,
    chunks: chunks.length,
    ...(previous && {
      stale: { generation: previous.generation, chunks: previous.chunks },
    }),
  }
  try {
    await securityWrite(pointerService(), JSON.stringify(next))
    if (!sameApiKeys(keys, await readProviderApiKeys())) {
      throw new Error('provider API keys did not read back from the keychain')
    }
  } catch (error) {
    // If this restore also fails, the keychain stays on the new generation
    // while the file keeps the old one. Nothing recovers that automatically.
    try {
      await restorePointer(previous)
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        'provider key commit failed and could not be restored',
      )
    }
    await deleteGeneration(next).catch(error => logError(error))
    throw error
  }
  return { previous, next }
}

async function restorePointer(previous: Pointer | undefined): Promise<void> {
  if (previous) await securityWrite(pointerService(), JSON.stringify(previous))
  else await securityDelete(pointerService())
}

/** Undoes a commit whose profile file could not be written. Only a failed pointer restore is an error. */
export async function rollbackProviderApiKeys(
  commit: ProviderKeyCommit,
): Promise<void> {
  await restorePointer(commit.previous)
  // Leftover chunks are never read, so a failed delete is only garbage.
  await deleteGeneration(commit.next).catch(error => logError(error))
}

/** Removes the generation a committed save replaced. Failure here is harmless: the next save retries it via `stale`. */
export async function finishProviderApiKeys(
  commit: ProviderKeyCommit,
): Promise<void> {
  if (commit.previous) await deleteGeneration(commit.previous)
}
