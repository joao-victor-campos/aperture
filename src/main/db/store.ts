import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs'
import type { Connection, SavedQuery, Folder, HistoryEntry, Theme, ChatThread } from '../../shared/types'
import { encryptSecrets, decryptSecrets, hasPlaintextSecrets, type SecretCipher } from './secureFields'

interface StoreData {
  connections: Connection[]
  savedQueries: SavedQuery[]
  folders: Folder[]
  historyEntries: HistoryEntry[]
  themes: Theme[]
  activeThemeId: string | null
  chatThreads: ChatThread[]
  aiConfig: { apiKey: string | null; model: string; inlineCompletionEnabled: boolean }
}

const DEFAULTS: StoreData = {
  connections: [],
  savedQueries: [],
  folders: [],
  historyEntries: [],
  themes: [],
  activeThemeId: null,
  chatThreads: [],
  aiConfig: { apiKey: null, model: 'claude-sonnet-4-6', inlineCompletionEnabled: false },
}

// safeStorage behind the injectable-cipher seam. The availability probe is
// defensive: if safeStorage is missing or throws (bare test mocks, exotic
// runtimes), we degrade to plaintext instead of crashing.
const cipher: SecretCipher = {
  isEncryptionAvailable: () => {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  },
  encryptString: (s) => safeStorage.encryptString(s),
  decryptString: (b) => safeStorage.decryptString(b),
}

let warnedUnavailable = false
/** One-time warning, only when there are actual secrets we cannot protect. */
function warnIfUnprotected(data: StoreData): void {
  if (warnedUnavailable || cipher.isEncryptionAvailable()) return
  if (hasPlaintextSecrets(data)) {
    warnedUnavailable = true
    console.warn('store: OS keychain encryption unavailable — secrets are stored in plaintext')
  }
}

let data: StoreData | null = null

function getStorePath(): string {
  return join(app.getPath('userData'), 'aperture-store.json')
}

function load(): StoreData {
  const path = getStorePath()
  if (!existsSync(path)) return { ...DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as StoreData
    const needsMigration = hasPlaintextSecrets(raw) && cipher.isEncryptionAvailable()
    const loaded = decryptSecrets(raw, cipher)
    if (needsMigration) {
      // One-time backup of the pre-encryption file, then re-persist encrypted.
      const bak = `${path}.bak`
      if (!existsSync(bak)) copyFileSync(path, bak)
      persist(loaded)
    }
    warnIfUnprotected(loaded)
    return loaded
  } catch {
    return { ...DEFAULTS }
  }
}

function persist(d: StoreData): void {
  const path = getStorePath()
  const dir = path.substring(0, path.lastIndexOf('/'))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  warnIfUnprotected(d)
  writeFileSync(path, JSON.stringify(encryptSecrets(d, cipher), null, 2), 'utf-8')
}

export const store = {
  get<K extends keyof StoreData>(key: K): StoreData[K] {
    if (!data) data = load()
    return data[key] ?? DEFAULTS[key]
  },
  set<K extends keyof StoreData>(key: K, value: StoreData[K]): void {
    if (!data) data = load()
    data[key] = value
    persist(data)
  }
}
