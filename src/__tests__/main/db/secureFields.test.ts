/**
 * secureFields.test.ts
 * Pure unit tests for the enc:v1 secret envelope. Uses a fake, reversible
 * cipher — no Electron involved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Connection } from '../../../shared/types'
import {
  ENC_PREFIX,
  type SecretCipher,
  isEncrypted,
  hasPlaintextSecrets,
  encryptSecrets,
  decryptSecrets,
} from '../../../main/db/secureFields'

/** Reversible fake: encrypt = "sealed:<plain>", decrypt strips it (throws otherwise). */
function makeCipher(available = true): SecretCipher {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`sealed:${plain}`, 'utf-8'),
    decryptString: (buf) => {
      const s = buf.toString('utf-8')
      if (!s.startsWith('sealed:')) throw new Error('decryption failed')
      return s.slice('sealed:'.length)
    },
  }
}

function pgConn(password = 'hunter2'): Connection {
  return {
    id: 'c1', name: 'PG', engine: 'postgres', createdAt: '2024-01-01T00:00:00.000Z',
    host: 'localhost', port: 5432, database: 'db', user: 'u', password,
  }
}
function bqConn(): Connection {
  return {
    id: 'c2', name: 'BQ', engine: 'bigquery', createdAt: '2024-01-01T00:00:00.000Z',
    projectId: 'p', credentialType: 'adc',
  }
}
const aiConfig = { apiKey: 'sk-ant-secret', model: 'm', inlineCompletionEnabled: false }

/** Manually build the on-disk form the fake cipher produces. */
function sealed(plain: string): string {
  return ENC_PREFIX + Buffer.from(`sealed:${plain}`, 'utf-8').toString('base64')
}

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warnSpy.mockRestore()
})

describe('isEncrypted', () => {
  it('detects the enc:v1: prefix', () => {
    expect(isEncrypted('enc:v1:abc')).toBe(true)
    expect(isEncrypted('hunter2')).toBe(false)
    expect(isEncrypted('')).toBe(false)
  })
})

describe('encryptSecrets / decryptSecrets round-trip', () => {
  it('encrypts passwords and apiKey, and decrypts them back to the originals', () => {
    const cipher = makeCipher()
    const data = { connections: [pgConn()], aiConfig }

    const enc = encryptSecrets(data, cipher)
    expect((enc.connections![0] as { password: string }).password).toBe(sealed('hunter2'))
    expect(enc.aiConfig!.apiKey).toBe(sealed('sk-ant-secret'))

    const dec = decryptSecrets(enc, cipher)
    expect((dec.connections![0] as { password: string }).password).toBe('hunter2')
    expect(dec.aiConfig!.apiKey).toBe('sk-ant-secret')
  })

  it('is idempotent — already-encrypted values pass through encryptSecrets untouched', () => {
    const cipher = makeCipher()
    const once = encryptSecrets({ connections: [pgConn()], aiConfig }, cipher)
    const twice = encryptSecrets(once, cipher)
    expect(twice).toEqual(once)
  })

  it('leaves bigquery connections (no password field) untouched', () => {
    const cipher = makeCipher()
    const enc = encryptSecrets({ connections: [bqConn()] }, cipher)
    expect(enc.connections![0]).toEqual(bqConn())
  })

  it('leaves empty passwords and null apiKey untouched', () => {
    const cipher = makeCipher()
    const enc = encryptSecrets(
      { connections: [pgConn('')], aiConfig: { ...aiConfig, apiKey: null } },
      cipher,
    )
    expect((enc.connections![0] as { password: string }).password).toBe('')
    expect(enc.aiConfig!.apiKey).toBeNull()
  })

  it('returns data unchanged when encryption is unavailable', () => {
    const cipher = makeCipher(false)
    const data = { connections: [pgConn()], aiConfig }
    expect(encryptSecrets(data, cipher)).toEqual(data)
  })

  it('never encrypts twice: snowflake and neo4j passwords are covered too', () => {
    const cipher = makeCipher()
    const sf: Connection = {
      id: 's1', name: 'SF', engine: 'snowflake', createdAt: '2024-01-01T00:00:00.000Z',
      account: 'a', username: 'u', password: 'sfpass', warehouse: 'w',
    }
    const neo: Connection = {
      id: 'n1', name: 'NEO', engine: 'neo4j', createdAt: '2024-01-01T00:00:00.000Z',
      uri: 'neo4j://x', username: 'u', password: 'neopass',
    }
    const enc = encryptSecrets({ connections: [sf, neo] }, cipher)
    expect((enc.connections![0] as { password: string }).password).toBe(sealed('sfpass'))
    expect((enc.connections![1] as { password: string }).password).toBe(sealed('neopass'))
  })

  it('does not mutate its input', () => {
    const cipher = makeCipher()
    const conn = pgConn()
    const data = { connections: [conn], aiConfig: { ...aiConfig } }
    encryptSecrets(data, cipher)
    expect(conn.password).toBe('hunter2')
    expect(data.aiConfig.apiKey).toBe('sk-ant-secret')
  })

  it('passes plaintext values through decryptSecrets untouched', () => {
    const cipher = makeCipher()
    const dec = decryptSecrets({ connections: [pgConn()], aiConfig }, cipher)
    expect((dec.connections![0] as { password: string }).password).toBe('hunter2')
    expect(dec.aiConfig!.apiKey).toBe('sk-ant-secret')
  })

  it('resets a value that fails to decrypt to "" and warns, leaving the rest intact', () => {
    const cipher = makeCipher()
    const corrupt = ENC_PREFIX + Buffer.from('garbage', 'utf-8').toString('base64')
    const dec = decryptSecrets(
      { connections: [{ ...pgConn(), password: corrupt } as Connection, bqConn()], aiConfig: { ...aiConfig, apiKey: sealed('ok') } },
      cipher,
    )
    expect((dec.connections![0] as { password: string }).password).toBe('')
    expect(dec.aiConfig!.apiKey).toBe('ok')
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('returns plaintext when encryptString itself throws (never brick)', () => {
    const cipher: SecretCipher = {
      isEncryptionAvailable: () => true,
      encryptString: () => { throw new Error('keychain locked') },
      decryptString: () => '',
    }
    const enc = encryptSecrets({ connections: [pgConn()] }, cipher)
    expect((enc.connections![0] as { password: string }).password).toBe('hunter2')
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('tolerates partial store shapes (missing connections / aiConfig)', () => {
    const cipher = makeCipher()
    expect(encryptSecrets({}, cipher)).toEqual({})
    expect(decryptSecrets({ connections: [pgConn()] }, cipher).aiConfig).toBeUndefined()
  })
})

describe('hasPlaintextSecrets', () => {
  it('is true for a plaintext password, false once encrypted', () => {
    const cipher = makeCipher()
    const data = { connections: [pgConn()] }
    expect(hasPlaintextSecrets(data)).toBe(true)
    expect(hasPlaintextSecrets(encryptSecrets(data, cipher))).toBe(false)
  })

  it('is true for a plaintext apiKey', () => {
    expect(hasPlaintextSecrets({ aiConfig })).toBe(true)
  })

  it('is false for empty/null secrets, bigquery-only stores, and partial shapes', () => {
    expect(hasPlaintextSecrets({ connections: [pgConn('')], aiConfig: { ...aiConfig, apiKey: null } })).toBe(false)
    expect(hasPlaintextSecrets({ connections: [bqConn()] })).toBe(false)
    expect(hasPlaintextSecrets({})).toBe(false)
  })
})
