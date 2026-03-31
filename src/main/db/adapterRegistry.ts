import type { WebContents } from 'electron'
import type {
  BigQueryConnection,
  Connection,
  ConnectionEngine,
  Dataset,
  PostgresConnection,
  QueryResult,
  Table,
  TableField
} from '../../shared/types'

import {
  testConnection as testBigQuery,
  listDatasets as listBigQueryDatasets,
  listTables as listBigQueryTables,
  getTableSchema as getBigQueryTableSchema,
  runQuery as runBigQueryQuery,
  getQueryPage as getBigQueryPage,
  cancelRunningQuery as cancelBigQuery,
  dryRunQuery as dryRunBigQuery,
  invalidateClient as invalidateBigQuery
} from './bigquery'

import {
  testConnection as testPostgres,
  listDatasets as listPostgresDatasets,
  listTables as listPostgresTables,
  getTableSchema as getPostgresTableSchema,
  runQuery as runPostgresQuery,
  getQueryPage as getPostgresPage,
  cancelRunningQuery as cancelPostgres,
  dryRunQuery as dryRunPostgres,
  invalidateClient as invalidatePostgres
} from './postgres'

export interface DbAdapter<TConnection extends Connection> {
  testConnection(connection: TConnection): Promise<{ ok: boolean; error?: string }>
  listDatasets(connection: TConnection): Promise<Dataset[]>
  listTables(connection: TConnection, datasetId: string): Promise<Table[]>
  getTableSchema(connection: TConnection, datasetId: string, tableId: string): Promise<TableField[]>

  runQuery(
    connection: TConnection,
    sql: string,
    tabId: string,
    webContents: WebContents
  ): Promise<QueryResult>

  getQueryPage(tabId: string, pageToken: string): Promise<QueryResult>
  cancelRunningQuery(tabId: string): Promise<void>
  dryRunQuery(connection: TConnection, sql: string): Promise<{ bytesProcessed: number }>

  invalidateClient(connectionId: string): void
}

const bigQueryAdapter: DbAdapter<BigQueryConnection> = {
  testConnection: testBigQuery,
  listDatasets: listBigQueryDatasets,
  listTables: listBigQueryTables,
  getTableSchema: getBigQueryTableSchema,
  runQuery: runBigQueryQuery,
  getQueryPage: getBigQueryPage,
  cancelRunningQuery: cancelBigQuery,
  dryRunQuery: dryRunBigQuery,
  invalidateClient: invalidateBigQuery
}

const postgresAdapter: DbAdapter<PostgresConnection> = {
  testConnection: testPostgres,
  listDatasets: listPostgresDatasets,
  listTables: listPostgresTables,
  getTableSchema: getPostgresTableSchema,
  runQuery: runPostgresQuery,
  getQueryPage: getPostgresPage,
  cancelRunningQuery: cancelPostgres,
  dryRunQuery: dryRunPostgres,
  invalidateClient: invalidatePostgres
}

const registry: Record<ConnectionEngine, DbAdapter<Connection>> = {
  bigquery: bigQueryAdapter as DbAdapter<Connection>,
  postgres: postgresAdapter as DbAdapter<Connection>
}

export function getAdapterForEngine(engine: ConnectionEngine): DbAdapter<Connection> {
  return registry[engine]
}

export function getAdapterForConnection(connection: Connection): DbAdapter<Connection> {
  return connection.engine === 'bigquery' ? getAdapterForEngine('bigquery') : getAdapterForEngine('postgres')
}

