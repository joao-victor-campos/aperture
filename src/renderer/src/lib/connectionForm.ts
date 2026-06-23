import type { BigQueryConnection, ConnectionCreate, ConnectionEngine } from '@shared/types'

/**
 * Flat, engine-agnostic snapshot of every ConnectionModal form field.
 * The component assembles this from its useState values and hands it to the
 * pure helpers below. Keeping every field present (not a discriminated union)
 * keeps the assembly site in the component trivial.
 */
export interface ConnectionFormFields {
  engine: ConnectionEngine
  name: string
  // BigQuery
  projectId: string
  credentialType: BigQueryConnection['credentialType']
  serviceAccountPath: string
  // Postgres
  host: string
  port: string
  pgDatabase: string
  pgUser: string
  pgPassword: string
  // Snowflake
  sfAccount: string
  sfUsername: string
  sfPassword: string
  sfWarehouse: string
  sfDatabase: string
  sfSchema: string
  sfRole: string
  // Neo4j
  neoUri: string
  neoUsername: string
  neoPassword: string
  neoDatabase: string
}

/** True when the form holds the minimum required fields for its engine. */
export function isConnectionInputValid(f: ConnectionFormFields): boolean {
  if (!f.name.trim()) return false
  if (f.engine === 'bigquery') return Boolean(f.projectId.trim())
  if (f.engine === 'postgres')
    return Boolean(
      f.host.trim() &&
        f.pgDatabase.trim() &&
        f.pgUser.trim() &&
        f.pgPassword.trim() &&
        Number.isFinite(Number(f.port)) &&
        Number(f.port) > 0
    )
  if (f.engine === 'neo4j')
    return Boolean(f.neoUri.trim() && f.neoUsername.trim() && f.neoPassword.trim())
  // snowflake
  return Boolean(
    f.sfAccount.trim() && f.sfUsername.trim() && f.sfPassword.trim() && f.sfWarehouse.trim()
  )
}

/** Construct the engine-specific ConnectionCreate payload from the form fields. */
export function buildConnectionPayload(f: ConnectionFormFields): ConnectionCreate {
  if (f.engine === 'bigquery') {
    return {
      engine: 'bigquery',
      name: f.name.trim(),
      projectId: f.projectId.trim(),
      credentialType: f.credentialType,
      serviceAccountPath:
        f.credentialType === 'service-account' ? f.serviceAccountPath.trim() : undefined,
    }
  }
  if (f.engine === 'postgres') {
    return {
      engine: 'postgres',
      name: f.name.trim(),
      host: f.host.trim(),
      port: Number(f.port),
      database: f.pgDatabase.trim(),
      user: f.pgUser.trim(),
      password: f.pgPassword,
    }
  }
  if (f.engine === 'neo4j') {
    return {
      engine: 'neo4j',
      name: f.name.trim(),
      uri: f.neoUri.trim(),
      username: f.neoUsername.trim(),
      password: f.neoPassword,
      database: f.neoDatabase.trim() || undefined,
    }
  }
  return {
    engine: 'snowflake',
    name: f.name.trim(),
    account: f.sfAccount.trim(),
    username: f.sfUsername.trim(),
    password: f.sfPassword.trim(),
    warehouse: f.sfWarehouse.trim(),
    database: f.sfDatabase.trim() || undefined,
    schema: f.sfSchema.trim() || undefined,
    role: f.sfRole.trim() || undefined,
  }
}
