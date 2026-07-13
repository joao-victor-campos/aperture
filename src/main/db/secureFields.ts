import type { Connection } from '../../shared/types'

/**
 * Prefix marking an encrypted secret value on disk.
 *
 * Tradeoff: the encrypted-or-not check is in-band (a value is "encrypted"
 * iff it starts with this prefix). A genuine secret that itself happens to
 * start with `enc:v1:` cannot be round-tripped — the write path treats it
 * as already encrypted and stores it verbatim.
 */
export const ENC_PREFIX = 'enc:v1:'

/**
 * Injectable wrapper over Electron's safeStorage so this module stays
 * unit-testable without an Electron runtime.
 */
export interface SecretCipher {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

/**
 * The store keys that carry secrets. Fields are optional because store files
 * can be partial (missing keys fall back to DEFAULTS at read time).
 */
export interface SecretStoreShape {
  connections?: Connection[]
  aiConfig?: { apiKey: string | null; model: string; inlineCompletionEnabled: boolean }
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX)
}

/** True when at least one secret is stored in plaintext (i.e. needs migration). */
export function hasPlaintextSecrets(data: SecretStoreShape): boolean {
  const plainConnection = (data.connections ?? []).some(
    (c) =>
      'password' in c &&
      typeof c.password === 'string' &&
      c.password !== '' &&
      !isEncrypted(c.password),
  )
  const apiKey = data.aiConfig?.apiKey
  const plainApiKey = typeof apiKey === 'string' && apiKey !== '' && !isEncrypted(apiKey)
  return plainConnection || plainApiKey
}

function encryptValue(value: string, cipher: SecretCipher): string {
  if (value === '' || isEncrypted(value) || !cipher.isEncryptionAvailable()) return value
  try {
    return ENC_PREFIX + cipher.encryptString(value).toString('base64')
  } catch {
    // Never brick a write: an encryption failure keeps the value plaintext.
    console.warn('secureFields: encryption failed — storing the value in plaintext')
    return value
  }
}

function decryptValue(value: string, cipher: SecretCipher): string {
  if (value === '' || !isEncrypted(value)) return value
  try {
    return cipher.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    // Keychain reset / store copied from another machine: lose one secret,
    // never the store. The user re-enters it in the UI.
    console.warn('secureFields: failed to decrypt a stored secret — it was reset; re-enter it in the UI')
    return ''
  }
}

function mapSecrets<T extends SecretStoreShape>(data: T, fn: (value: string) => string): T {
  const out: T = { ...data }
  if (data.connections) {
    out.connections = data.connections.map((c) =>
      // A hand-edited or corrupted store file can carry a non-string
      // password (e.g. `null`); pass it through untouched rather than
      // calling fn (and isEncrypted, transitively) on a non-string value.
      'password' in c && typeof c.password === 'string' ? { ...c, password: fn(c.password) } : c,
    )
  }
  if (data.aiConfig) {
    const { apiKey } = data.aiConfig
    out.aiConfig = { ...data.aiConfig, apiKey: typeof apiKey === 'string' ? fn(apiKey) : apiKey }
  }
  return out
}

/** Returns a copy with every plaintext secret encrypted (no-op when unavailable). */
export function encryptSecrets<T extends SecretStoreShape>(data: T, cipher: SecretCipher): T {
  return mapSecrets(data, (v) => encryptValue(v, cipher))
}

/** Returns a copy with every enc:v1: secret decrypted (failures become ''). */
export function decryptSecrets<T extends SecretStoreShape>(data: T, cipher: SecretCipher): T {
  return mapSecrets(data, (v) => decryptValue(v, cipher))
}
