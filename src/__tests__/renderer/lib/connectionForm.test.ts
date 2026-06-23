import { describe, it, expect } from 'vitest'
import {
  isConnectionInputValid,
  type ConnectionFormFields,
} from '../../../renderer/src/lib/connectionForm'

/** A fully-valid BigQuery fields snapshot; override per test. */
function makeFields(overrides: Partial<ConnectionFormFields> = {}): ConnectionFormFields {
  return {
    engine: 'bigquery',
    name: 'My Conn',
    projectId: 'my-project',
    credentialType: 'adc',
    serviceAccountPath: '',
    host: 'localhost',
    port: '5432',
    pgDatabase: 'db',
    pgUser: 'user',
    pgPassword: 'pass',
    sfAccount: 'acct',
    sfUsername: 'sfuser',
    sfPassword: 'sfpass',
    sfWarehouse: 'WH',
    sfDatabase: '',
    sfSchema: '',
    sfRole: '',
    neoUri: 'neo4j://localhost:7687',
    neoUsername: 'neo4j',
    neoPassword: 'neopass',
    neoDatabase: '',
    ...overrides,
  }
}

describe('isConnectionInputValid', () => {
  it('returns false when the connection name is blank, for any engine', () => {
    expect(isConnectionInputValid(makeFields({ name: '   ' }))).toBe(false)
    expect(isConnectionInputValid(makeFields({ engine: 'postgres', name: '' }))).toBe(false)
  })

  describe('bigquery', () => {
    it('is valid with a project id', () => {
      expect(isConnectionInputValid(makeFields({ engine: 'bigquery' }))).toBe(true)
    })
    it('is invalid without a project id', () => {
      expect(isConnectionInputValid(makeFields({ engine: 'bigquery', projectId: '  ' }))).toBe(false)
    })
  })

  describe('postgres', () => {
    it('is valid with host, database, user, password and a positive numeric port', () => {
      expect(isConnectionInputValid(makeFields({ engine: 'postgres' }))).toBe(true)
    })
    it('is invalid when a required field is blank', () => {
      expect(isConnectionInputValid(makeFields({ engine: 'postgres', host: '' }))).toBe(false)
      expect(isConnectionInputValid(makeFields({ engine: 'postgres', pgDatabase: '' }))).toBe(false)
      expect(isConnectionInputValid(makeFields({ engine: 'postgres', pgUser: '' }))).toBe(false)
      expect(isConnectionInputValid(makeFields({ engine: 'postgres', pgPassword: '' }))).toBe(false)
    })
    it('is invalid when the port is non-numeric or not positive', () => {
      expect(isConnectionInputValid(makeFields({ engine: 'postgres', port: 'abc' }))).toBe(false)
      expect(isConnectionInputValid(makeFields({ engine: 'postgres', port: '0' }))).toBe(false)
      expect(isConnectionInputValid(makeFields({ engine: 'postgres', port: '-1' }))).toBe(false)
    })
  })

  describe('neo4j', () => {
    it('is valid with uri, username and password', () => {
      expect(isConnectionInputValid(makeFields({ engine: 'neo4j' }))).toBe(true)
    })
    it('is invalid when any of uri/username/password is blank', () => {
      expect(isConnectionInputValid(makeFields({ engine: 'neo4j', neoUri: '' }))).toBe(false)
      expect(isConnectionInputValid(makeFields({ engine: 'neo4j', neoUsername: '' }))).toBe(false)
      expect(isConnectionInputValid(makeFields({ engine: 'neo4j', neoPassword: '' }))).toBe(false)
    })
  })

  describe('snowflake', () => {
    it('is valid with account, username, password and warehouse', () => {
      expect(isConnectionInputValid(makeFields({ engine: 'snowflake' }))).toBe(true)
    })
    it('is invalid when a required field is blank', () => {
      expect(isConnectionInputValid(makeFields({ engine: 'snowflake', sfAccount: '' }))).toBe(false)
      expect(isConnectionInputValid(makeFields({ engine: 'snowflake', sfWarehouse: '' }))).toBe(false)
    })
    it('does not require the optional database/schema/role fields', () => {
      expect(
        isConnectionInputValid(
          makeFields({ engine: 'snowflake', sfDatabase: '', sfSchema: '', sfRole: '' })
        )
      ).toBe(true)
    })
  })
})
