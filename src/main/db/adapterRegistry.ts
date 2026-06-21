import type { WebContents } from 'electron'
import type {
  BigQueryConnection,
  Connection,
  ConnectionEngine,
  Dataset,
  Neo4jConnection,
  PostgresConnection,
  SnowflakeConnection,
  QueryResult,
  Table,
  TableField,
  TableSearchHit
} from '../../shared/types'

import {
  testConnection as testBigQuery,
  listDatasets as listBigQueryDatasets,
  listTables as listBigQueryTables,
  getTableSchema as getBigQueryTableSchema,
  searchTables as searchBigQueryTables,
  getDatasetColumns as getBigQueryDatasetColumns,
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
  searchTables as searchPostgresTables,
  getDatasetColumns as getPostgresDatasetColumns,
  runQuery as runPostgresQuery,
  getQueryPage as getPostgresPage,
  cancelRunningQuery as cancelPostgres,
  dryRunQuery as dryRunPostgres,
  invalidateClient as invalidatePostgres
} from './postgres'

import {
  testConnection as testSnowflake,
  listDatasets as listSnowflakeDatasets,
  listTables as listSnowflakeTables,
  getTableSchema as getSnowflakeTableSchema,
  searchTables as searchSnowflakeTables,
  getDatasetColumns as getSnowflakeDatasetColumns,
  runQuery as runSnowflakeQuery,
  getQueryPage as getSnowflakePage,
  cancelRunningQuery as cancelSnowflake,
  dryRunQuery as dryRunSnowflake,
  invalidateClient as invalidateSnowflake
} from './snowflake'

import {
  testConnection as testNeo4j,
  listDatasets as listNeo4jDatasets,
  listTables as listNeo4jTables,
  getTableSchema as getNeo4jTableSchema,
  searchTables as searchNeo4jTables,
  getDatasetColumns as getNeo4jDatasetColumns,
  runQuery as runNeo4jQuery,
  getQueryPage as getNeo4jPage,
  cancelRunningQuery as cancelNeo4j,
  dryRunQuery as dryRunNeo4j,
  invalidateClient as invalidateNeo4j
} from './neo4j'

export interface DbAdapter<TConnection extends Connection> {
  testConnection(connection: TConnection): Promise<{ ok: boolean; error?: string }>
  listDatasets(connection: TConnection): Promise<Dataset[]>
  listTables(connection: TConnection, datasetId: string): Promise<Table[]>
  getTableSchema(connection: TConnection, datasetId: string, tableId: string): Promise<TableField[]>
  /** Bulk column fetch for a whole dataset — powers catalog warm-up. */
  getDatasetColumns(connection: TConnection, datasetId: string): Promise<Record<string, TableField[]>>
  /** Catalog-wide substring search for ⌘K command palette. */
  searchTables(connection: TConnection, query: string, limit: number): Promise<TableSearchHit[]>

  runQuery(
    connection: TConnection,
    sql: string,
    tabId: string,
    webContents: WebContents
  ): Promise<QueryResult>

  getQueryPage(tabId: string, pageToken: string): Promise<QueryResult>
  cancelRunningQuery(tabId: string): Promise<void>
  dryRunQuery(connection: TConnection, sql: string): Promise<{ bytesProcessed: number; plan?: string; planFormat?: 'text' | 'json' }>

  invalidateClient(connectionId: string): void
}

const bigQueryAdapter: DbAdapter<BigQueryConnection> = {
  testConnection: testBigQuery,
  listDatasets: listBigQueryDatasets,
  listTables: listBigQueryTables,
  getTableSchema: getBigQueryTableSchema,
  getDatasetColumns: getBigQueryDatasetColumns,
  searchTables: searchBigQueryTables,
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
  getDatasetColumns: getPostgresDatasetColumns,
  searchTables: searchPostgresTables,
  runQuery: runPostgresQuery,
  getQueryPage: getPostgresPage,
  cancelRunningQuery: cancelPostgres,
  dryRunQuery: dryRunPostgres,
  invalidateClient: invalidatePostgres
}

const snowflakeAdapter: DbAdapter<SnowflakeConnection> = {
  testConnection: testSnowflake,
  listDatasets: listSnowflakeDatasets,
  listTables: listSnowflakeTables,
  getTableSchema: getSnowflakeTableSchema,
  getDatasetColumns: getSnowflakeDatasetColumns,
  searchTables: searchSnowflakeTables,
  runQuery: runSnowflakeQuery,
  getQueryPage: getSnowflakePage,
  cancelRunningQuery: cancelSnowflake,
  dryRunQuery: dryRunSnowflake,
  invalidateClient: invalidateSnowflake
}

const neo4jAdapter: DbAdapter<Neo4jConnection> = {
  testConnection: testNeo4j,
  listDatasets: listNeo4jDatasets,
  listTables: listNeo4jTables,
  getTableSchema: getNeo4jTableSchema,
  getDatasetColumns: getNeo4jDatasetColumns,
  searchTables: searchNeo4jTables,
  runQuery: runNeo4jQuery,
  getQueryPage: getNeo4jPage,
  cancelRunningQuery: cancelNeo4j,
  dryRunQuery: dryRunNeo4j,
  invalidateClient: invalidateNeo4j
}

const registry: Record<ConnectionEngine, DbAdapter<Connection>> = {
  bigquery: bigQueryAdapter as DbAdapter<Connection>,
  postgres: postgresAdapter as DbAdapter<Connection>,
  snowflake: snowflakeAdapter as DbAdapter<Connection>,
  neo4j: neo4jAdapter as DbAdapter<Connection>
}

export function getAdapterForEngine(engine: ConnectionEngine): DbAdapter<Connection> {
  return registry[engine]
}

export function getAdapterForConnection(connection: Connection): DbAdapter<Connection> {
  // Connections saved before the engine field was added default to BigQuery
  return registry[connection.engine ?? 'bigquery']
}

