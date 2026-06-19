import { CHANNELS } from '@shared/ipc'
import type { AiToolDef } from '@shared/types'

export const TOOL_DEFS: AiToolDef[] = [
  {
    name: 'list_datasets',
    description: 'List datasets/schemas in the active connection.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'search_tables',
    description: 'Find tables by a substring of their name across the active connection.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Substring to search for (min 2 chars).' } },
      required: ['query'],
    },
  },
  {
    name: 'list_tables',
    description: 'List all tables in a specific dataset/schema. Use this to enumerate what exists in a dataset before searching by name or guessing.',
    input_schema: {
      type: 'object',
      properties: { datasetId: { type: 'string', description: 'The dataset/schema id to list tables for.' } },
      required: ['datasetId'],
    },
  },
  {
    name: 'get_table_schema',
    description: 'Get the columns and types of a specific table.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (use "" if not applicable).' },
        datasetId: { type: 'string' },
        tableId: { type: 'string' },
      },
      required: ['datasetId', 'tableId'],
    },
  },
  {
    name: 'open_query_tab',
    description: 'Open a new editor tab containing the given SQL for the user to see/run.',
    input_schema: {
      type: 'object',
      properties: { sql: { type: 'string' } },
      required: ['sql'],
    },
  },
  {
    name: 'dry_run_query',
    description: 'Validate SQL and estimate bytes processed without executing it.',
    input_schema: {
      type: 'object',
      properties: { sql: { type: 'string' } },
      required: ['sql'],
    },
  },
  {
    name: 'run_query',
    description: 'Execute SQL against the active connection. Requires user confirmation. Returns a capped row sample.',
    input_schema: {
      type: 'object',
      properties: { sql: { type: 'string' } },
      required: ['sql'],
    },
  },
]

export interface DataToolContext {
  connectionId: string
}

/**
 * Execute a side-effect-free "data" tool by forwarding to existing IPC channels.
 * Returns a string suitable for a tool_result. Throws for interactive tools
 * (open_query_tab, run_query), which the chat store handles itself.
 */
export async function runDataTool(
  name: string,
  input: Record<string, unknown>,
  ctx: DataToolContext
): Promise<string> {
  switch (name) {
    case 'list_datasets': {
      const r = await window.api.invoke(CHANNELS.CATALOG_DATASETS, ctx.connectionId)
      return JSON.stringify(r)
    }
    case 'search_tables': {
      const r = await window.api.invoke(CHANNELS.CATALOG_SEARCH_TABLES, {
        connectionId: ctx.connectionId,
        query: String(input.query ?? ''),
      })
      return JSON.stringify(r)
    }
    case 'list_tables': {
      const r = await window.api.invoke(CHANNELS.CATALOG_TABLES, {
        connectionId: ctx.connectionId,
        datasetId: String(input.datasetId ?? ''),
      })
      return JSON.stringify(r)
    }
    case 'get_table_schema': {
      const r = await window.api.invoke(CHANNELS.CATALOG_TABLE_SCHEMA, {
        connectionId: ctx.connectionId,
        projectId: String(input.projectId ?? ''),
        datasetId: String(input.datasetId ?? ''),
        tableId: String(input.tableId ?? ''),
      })
      return JSON.stringify(r)
    }
    case 'dry_run_query': {
      const r = await window.api.invoke(CHANNELS.QUERY_DRY_RUN, {
        connectionId: ctx.connectionId,
        sql: String(input.sql ?? ''),
      })
      return JSON.stringify(r)
    }
    default:
      throw new Error(`Not a data tool: ${name}`)
  }
}
