import { useState, useEffect, useMemo } from 'react'
import { Copy, Check, Search, X, Play } from 'lucide-react'
import { CHANNELS } from '@shared/ipc'
import type { TableField, QueryResult, ConnectionEngine } from '@shared/types'
import { useCatalogStore } from '../../store/catalogStore'
import { useConnectionStore } from '../../store/connectionStore'
import { useQueryStore } from '../../store/queryStore'
import { buildSelectQuery } from '../../lib/buildSelectQuery'
import { buildTableQuery } from '../../lib/buildTableQuery'
import { buildLabelQuery, buildRelationshipTypeQuery } from '../../lib/buildCypherQuery'
import { flattenFields } from '../../lib/flattenFields'
import { typeColor } from '../../lib/schemaTypeColor'
import { formatCell } from '../../lib/formatCell'

interface TableDetailPanelProps {
  connectionId: string
  projectId: string
  datasetId: string
  tableId: string
  tableName: string
}

type Section = 'schema' | 'preview'

export default function TableDetailPanel({
  connectionId, projectId, datasetId, tableId, tableName,
}: TableDetailPanelProps) {
  const [section, setSection] = useState<Section>('schema')
  const [schema, setSchema] = useState<TableField[] | null>(null)
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [schemaError, setSchemaError] = useState<string | null>(null)

  const [preview, setPreview] = useState<QueryResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoaded, setPreviewLoaded] = useState(false)

  const [copied, setCopied] = useState(false)

  const { loadSchema, tablesByDataset } = useCatalogStore()
  const { connections } = useConnectionStore()
  const openTab = useQueryStore((s) => s.openTab)
  const engine = connections.find((c) => c.id === connectionId)?.engine ?? 'bigquery'

  const handleQueryTable = () => {
    const sql = buildTableQuery(engine, projectId, datasetId, tableId, tableType)
    openTab({ sql, connectionId, title: tableName })
  }

  const previewTabId = useMemo(() => crypto.randomUUID(), [connectionId, projectId, datasetId, tableId])

  const tableRef = `${datasetId}.${tableId}`
  // For Neo4j we need to know whether this is a LABEL or a RELATIONSHIP_TYPE to
  // pick the right Cypher builder — read it from the catalog cache.
  const tableType = tablesByDataset[`${connectionId}:${datasetId}`]?.find((t) => t.id === tableId)?.type

  // Engine-specific preview Cypher / SQL. We strip the builder's default LIMIT
  // and use 50 instead — preview is meant to be a quick peek, not a page.
  const previewRef = engine === 'neo4j'
    ? (tableType === 'RELATIONSHIP_TYPE'
        ? buildRelationshipTypeQuery(tableId)
        : buildLabelQuery(tableId)
      ).replace(' LIMIT 100', ' LIMIT 50')
    : buildSelectQuery(engine, projectId, datasetId, tableId).replace(' LIMIT 100', ' LIMIT 50')

  useEffect(() => {
    setSchema(null)
    setSchemaError(null)
    setPreview(null)
    setPreviewLoaded(false)
    setSection('schema')
    setSchemaLoading(true)
    loadSchema(connectionId, projectId, datasetId, tableId)
      .then((fields) => { setSchema(fields); setSchemaLoading(false) })
      .catch((err: Error) => { setSchemaError(err.message); setSchemaLoading(false) })
  }, [connectionId, projectId, datasetId, tableId])

  const handleSectionClick = (s: Section) => {
    setSection(s)
    if (s === 'preview' && !previewLoaded && !previewLoading) loadPreview()
  }

  const loadPreview = async () => {
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const result = await window.api.invoke(CHANNELS.QUERY_EXECUTE, {
        connectionId,
        sql: previewRef,
        tabId: previewTabId,
      })
      setPreview(result)
      setPreviewLoaded(true)
    } catch (err) {
      setPreviewError((err as Error).message)
      setPreviewLoaded(true)
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(tableRef)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-app-border bg-app-surface shrink-0">
        <div className="flex flex-col gap-0.5">
          <span className="app-section-label">Table</span>
          <span className="text-app-text font-semibold text-[15px]">{tableName}</span>
          <span className="text-[10px] text-app-text-3 font-mono">{tableRef}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleQueryTable}
            title="Open a query for this table"
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-app-accent hover:bg-app-accent-hover text-white transition-colors"
          >
            <Play size={12} />
            <span>Query</span>
          </button>
          <button
            onClick={handleCopy}
            title={engine === 'postgres' ? 'Copy schema.table reference' : 'Copy dataset.table reference'}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-app-elevated hover:bg-app-border/40 text-app-text-2 hover:text-app-text transition-colors border border-app-border"
          >
            {copied ? (
              <><Check size={12} className="text-app-ok" /><span className="text-app-ok">Copied</span></>
            ) : (
              <><Copy size={12} /><span className="font-tabular">{tableRef}</span></>
            )}
          </button>
        </div>
      </div>

      <div className="px-4 py-2 border-b border-app-border bg-app-surface shrink-0">
        <div className="app-segmented inline-flex">
          <button
            data-active={section === 'schema' || undefined}
            onClick={() => handleSectionClick('schema')}
          >
            Schema
          </button>
          <button
            data-active={section === 'preview' || undefined}
            onClick={() => handleSectionClick('preview')}
          >
            Preview
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {section === 'schema' && (
          <SchemaSection schema={schema} loading={schemaLoading} error={schemaError} engine={engine} />
        )}
        {section === 'preview' && (
          <PreviewSection result={preview} loading={previewLoading} error={previewError} onRetry={loadPreview} />
        )}
      </div>
    </div>
  )
}

function SchemaSection({ schema, loading, error, engine }: { schema: TableField[] | null; loading: boolean; error: string | null; engine?: ConnectionEngine }) {
  const [filter, setFilter] = useState('')

  if (loading) return <div className="p-4 text-xs text-app-text-3 animate-pulse">Loading schema…</div>
  if (error) {
    return (
      <div className="p-4">
        <div className="bg-app-err-subtle border border-app-err/30 rounded-lg p-3 text-xs font-mono text-app-err">{error}</div>
      </div>
    )
  }
  if (!schema || schema.length === 0) return <div className="p-4 text-xs text-app-text-3">No schema available.</div>

  const allRows = flattenFields(schema)
  const query = filter.trim().toLowerCase()
  const visibleRows = query
    ? allRows.filter((r) => r.field.name.toLowerCase().includes(query))
    : allRows

  return (
    <div className="flex flex-col h-full">
      {/* Column search bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-app-border bg-app-surface shrink-0">
        <Search size={12} className="text-app-text-3 shrink-0" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter columns…"
          className="flex-1 bg-transparent text-xs text-app-text placeholder-app-text-3 focus:outline-none"
        />
        {filter && (
          <button
            onClick={() => setFilter('')}
            className="text-app-text-3 hover:text-app-text transition-colors"
          >
            <X size={12} />
          </button>
        )}
        {query && (
          <span className="text-[10px] text-app-text-3 shrink-0">
            {visibleRows.length} / {allRows.length}
          </span>
        )}
      </div>

      {engine === 'neo4j' && (
        <div className="px-3 py-1.5 text-[11px] text-app-text-3 bg-app-warn-subtle/30 border-b border-app-border shrink-0">
          Inferred from up to 50 sampled records — Neo4j is schema-optional, so this list may be incomplete.
        </div>
      )}

      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 bg-app-bg z-10">
          <tr>
            <th className="px-4 py-2 text-left border-b border-app-border w-1/3"><span className="app-section-label">Column</span></th>
            <th className="px-4 py-2 text-left border-b border-app-border w-1/5"><span className="app-section-label">Type</span></th>
            <th className="px-4 py-2 text-left border-b border-app-border w-1/6"><span className="app-section-label">Mode</span></th>
            <th className="px-4 py-2 text-left border-b border-app-border"><span className="app-section-label">Description</span></th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-app-text-3">
                No columns match &ldquo;{filter}&rdquo;
              </td>
            </tr>
          ) : (
            visibleRows.map((row, i) => (
              <tr key={i} className={`hover:bg-app-elevated/30 transition-colors ${i % 2 === 0 ? '' : 'bg-app-surface/20'}`}>
                <td className="px-4 py-2 font-mono text-app-text border-b border-app-border/40">
                  {row.depth > 0 && <span className="text-app-text-3 mr-1">{'  '.repeat(row.depth)}↳</span>}
                  {row.field.name}
                </td>
                <td className="px-4 py-2 font-mono border-b border-app-border/40">
                  <span className={typeColor(row.field.type)}>{row.field.type}</span>
                </td>
                <td className="px-4 py-2 text-app-text-2 border-b border-app-border/40">
                  {row.field.mode !== 'NULLABLE' ? (
                    <span className={row.field.mode === 'REQUIRED' ? 'text-app-warn' : 'text-app-accent-text'}>
                      {row.field.mode}
                    </span>
                  ) : (
                    <span className="text-app-text-3">NULLABLE</span>
                  )}
                </td>
                <td className="px-4 py-2 text-app-text-3 border-b border-app-border/40 max-w-xs truncate">
                  {row.field.description ?? ''}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function PreviewSection({ result, loading, error, onRetry }: { result: QueryResult | null; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <div className="p-4 text-xs text-app-text-3 animate-pulse">Fetching preview…</div>
  if (error) {
    return (
      <div className="p-4 flex flex-col gap-3">
        <div className="bg-app-err-subtle border border-app-err/30 rounded-lg p-3 text-xs font-mono text-app-err">{error}</div>
        <button onClick={onRetry} className="text-xs text-app-accent-text hover:opacity-80 text-left">Retry</button>
      </div>
    )
  }
  if (!result) return null

  const { columns, rows, rowCount, executionTimeMs } = result

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-1.5 border-b border-app-border bg-app-surface shrink-0 sticky top-0 z-10">
        <span className="text-xs text-app-text-2 font-tabular">{rowCount} rows</span>
        <span className="text-xs text-app-text-3 font-tabular">{executionTimeMs}ms</span>
      </div>
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-[33px] bg-app-bg z-10">
          <tr>
            {columns.map((col) => (
              <th key={col} className="px-3 py-2 text-left text-app-text-2 font-medium border-b border-app-border whitespace-nowrap">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={`hover:bg-app-elevated/40 transition-colors ${i % 2 === 0 ? '' : 'bg-app-surface/30'}`}>
              {columns.map((col) => (
                <td key={col} className="px-3 py-1.5 text-app-text font-mono border-b border-app-border/40 whitespace-nowrap max-w-xs truncate">
                  {formatCell(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
