import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '@shared/ipc'
import { TOOL_DEFS, runDataTool } from '../../../renderer/src/ai/tools'

beforeEach(() => {
  vi.mocked(window.api.invoke).mockReset()
})

describe('TOOL_DEFS', () => {
  it('exposes the seven tools by name', () => {
    expect(TOOL_DEFS.map((t) => t.name).sort()).toEqual(
      ['dry_run_query', 'get_table_schema', 'list_datasets', 'list_tables', 'open_query_tab', 'run_query', 'search_tables'].sort()
    )
  })

  it('every tool has an object input_schema', () => {
    for (const t of TOOL_DEFS) expect((t.input_schema as { type: string }).type).toBe('object')
  })
})

describe('runDataTool', () => {
  it('search_tables forwards to CATALOG_SEARCH_TABLES and stringifies the result', async () => {
    vi.mocked(window.api.invoke).mockResolvedValue([{ datasetId: 'd', tableId: 't', name: 't', type: 'TABLE' }])
    const out = await runDataTool('search_tables', { query: 'ord' }, { connectionId: 'c1' })
    expect(window.api.invoke).toHaveBeenCalledWith(CHANNELS.CATALOG_SEARCH_TABLES, { connectionId: 'c1', query: 'ord' })
    expect(out).toContain('"tableId":"t"')
  })

  it('get_table_schema forwards dataset/table ids', async () => {
    vi.mocked(window.api.invoke).mockResolvedValue([{ name: 'id', type: 'INT64', mode: 'NULLABLE' }])
    await runDataTool('get_table_schema', { projectId: 'p', datasetId: 'd', tableId: 't' }, { connectionId: 'c1' })
    expect(window.api.invoke).toHaveBeenCalledWith(CHANNELS.CATALOG_TABLE_SCHEMA, {
      connectionId: 'c1', projectId: 'p', datasetId: 'd', tableId: 't',
    })
  })

  it('list_tables forwards the dataset id to CATALOG_TABLES', async () => {
    vi.mocked(window.api.invoke).mockResolvedValue([{ id: 'cards', name: 'cards', type: 'TABLE', datasetId: 'crawler', projectId: 'p' }])
    const out = await runDataTool('list_tables', { datasetId: 'crawler' }, { connectionId: 'c1' })
    expect(window.api.invoke).toHaveBeenCalledWith(CHANNELS.CATALOG_TABLES, { connectionId: 'c1', datasetId: 'crawler' })
    expect(out).toContain('"name":"cards"')
  })

  it('list_datasets forwards the connection id', async () => {
    vi.mocked(window.api.invoke).mockResolvedValue([])
    await runDataTool('list_datasets', {}, { connectionId: 'c1' })
    expect(window.api.invoke).toHaveBeenCalledWith(CHANNELS.CATALOG_DATASETS, 'c1')
  })

  it('dry_run_query forwards sql', async () => {
    vi.mocked(window.api.invoke).mockResolvedValue({ bytesProcessed: 1024 })
    const out = await runDataTool('dry_run_query', { sql: 'SELECT 1' }, { connectionId: 'c1' })
    expect(window.api.invoke).toHaveBeenCalledWith(CHANNELS.QUERY_DRY_RUN, { connectionId: 'c1', sql: 'SELECT 1' })
    expect(out).toContain('1024')
  })

  it('throws for a non-data tool', async () => {
    await expect(runDataTool('run_query', { sql: 'x' }, { connectionId: 'c1' })).rejects.toThrow()
  })
})
