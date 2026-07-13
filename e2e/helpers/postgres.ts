import type { PostgresConnection } from '../../src/shared/types'

/** Connection details for the dockerized E2E Postgres (docker/docker-compose.yml → postgres-e2e). */
export const PG = {
  host: '127.0.0.1',
  port: Number(process.env.E2E_PG_PORT ?? 54329),
  database: 'aperture_e2e',
  user: 'aperture',
  password: 'aperture',
}

export const PG_CONNECTION_NAME = 'E2E Postgres'

/** A ready-made connection object for seeding aperture-store.json via launchApp. */
export function seededPgConnection(): PostgresConnection {
  return {
    id: 'e2e-pg',
    name: PG_CONNECTION_NAME,
    engine: 'postgres',
    createdAt: new Date().toISOString(),
    host: PG.host,
    port: PG.port,
    database: PG.database,
    user: PG.user,
    password: PG.password,
  }
}
