import { describe, it, expect } from 'vitest'
import {
  isConnectionInputValid,
  buildConnectionPayload,
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

describe('buildConnectionPayload', () => {
  it('bigquery (adc): trims name/projectId and omits serviceAccountPath', () => {
    const p = buildConnectionPayload(
      makeFields({
        engine: 'bigquery',
        name: '  My Conn  ',
        projectId: '  my-project  ',
        credentialType: 'adc',
        serviceAccountPath: '/some/path.json',
      })
    )
    expect(p).toEqual({
      engine: 'bigquery',
      name: 'My Conn',
      projectId: 'my-project',
      credentialType: 'adc',
      serviceAccountPath: undefined,
    })
  })

  it('bigquery (service-account): includes the trimmed key path', () => {
    const p = buildConnectionPayload(
      makeFields({
        engine: 'bigquery',
        credentialType: 'service-account',
        serviceAccountPath: '  /keys/sa.json  ',
      })
    )
    expect(p).toMatchObject({
      engine: 'bigquery',
      credentialType: 'service-account',
      serviceAccountPath: '/keys/sa.json',
    })
  })

  it('postgres: coerces port to a number, trims fields, but preserves the password verbatim', () => {
    const p = buildConnectionPayload(
      makeFields({
        engine: 'postgres',
        host: '  db.example.com  ',
        port: '5433',
        pgDatabase: '  analytics  ',
        pgUser: '  reader  ',
        pgPassword: '  s3cret  ',
      })
    )
    expect(p).toEqual({
      engine: 'postgres',
      name: 'My Conn',
      host: 'db.example.com',
      port: 5433,
      database: 'analytics',
      user: 'reader',
      password: '  s3cret  ',
    })
  })

  it('neo4j: maps a blank database to undefined and preserves the password verbatim', () => {
    const p = buildConnectionPayload(
      makeFields({
        engine: 'neo4j',
        neoUri: '  neo4j://localhost:7687  ',
        neoUsername: '  neo4j  ',
        neoPassword: '  p@ss  ',
        neoDatabase: '   ',
      })
    )
    expect(p).toEqual({
      engine: 'neo4j',
      name: 'My Conn',
      uri: 'neo4j://localhost:7687',
      username: 'neo4j',
      password: '  p@ss  ',
      database: undefined,
    })
  })

  it('snowflake: trims the password and maps blank optional fields to undefined', () => {
    const p = buildConnectionPayload(
      makeFields({
        engine: 'snowflake',
        sfAccount: '  xy12345  ',
        sfUsername: '  USER  ',
        sfPassword: '  pw  ',
        sfWarehouse: '  COMPUTE_WH  ',
        sfDatabase: '   ',
        sfSchema: '',
        sfRole: '  SYSADMIN  ',
      })
    )
    expect(p).toEqual({
      engine: 'snowflake',
      name: 'My Conn',
      account: 'xy12345',
      username: 'USER',
      password: 'pw',
      warehouse: 'COMPUTE_WH',
      database: undefined,
      schema: undefined,
      role: 'SYSADMIN',
    })
  })
})
