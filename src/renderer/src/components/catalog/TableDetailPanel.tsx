import { useState, useEffect, useMemo } from 'react'
import { Copy, Check, Search, X } from 'lucide-react'
import { CHANNELS } from '@shared/ipc'
import type { TableField, QueryResult } from '@shared/types'
import { useCatalogStore } from '../../store/catalogStore'
import { useConnectionStore } from '../../store/connectionStore'
import { buildSelectQuery } from '../../lib/buildSelectQuery'

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

  const { loadSchema } = useCatalogStore()
  const { connections } = useConnectionStore()
  const engine = connections.find((c) => c.id === connectionId)?.engine ?? 'bigquery'

  const previewTabId = useMemo(() => crypto.randomUUID(), [connectionId, projectId, datasetId, tableId])

  const tableRef = `${datasetId}.${tableId}`
  // Use the shared builder (engine-specific quoting); strip " LIMIT 100" for the preview SQL
  const previewRef = buildSelectQuery(engine, projectId, datasetId, tableId).replace(' LIMIT 100', ' LIMIT 50')

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
          <span className="text-sm font-semibold text-app-text">{tableName}</span>
          <span className="text-[10px] text-app-text-3 font-mono">{tableRef}</span>
        </div>
        <button
          onClick={handleCopy}
          title={engine === 'postgres' ? 'Copy schema.table reference' : 'Copy dataset.table reference'}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-app-elevated hover:bg-app-border text-app-text-2 hover:text-app-text transition-colors border border-app-border"
        >
          {copied ? (
            <><Check size={12} className="text-emerald-500" /><span className="text-emerald-500">Copied</span></>
          ) : (
            <><Copy size={12} /><span>{tableRef}</span></>
          )}
        </button>
      </div>

      <div className="flex border-b border-app-border bg-app-surface shrink-0">
        <SectionTab label="Schema"  active={section === 'schema'}  onClick={() => handleSectionClick('schema')} />
        <SectionTab label="Preview" active={section === 'preview'} onClick={() => handleSectionClick('preview')} />
      </div>

      <div className="flex-1 overflow-auto">
        {section === 'schema' && (
          <SchemaSection schema={schema} loading={schemaLoading} error={schemaError} />
        )}
        {section === 'preview' && (
          <PreviewSection result={preview} loading={previewLoading} error={previewError} onRetry={loadPreview} />
        )}
      </div>
    </div>
  )
}

function SectionTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-xs transition-colors ${
        active ? 'text-app-accent-text border-b-2 border-app-accent' : 'text-app-text-2 hover:text-app-text'
      }`}
    >
      {label}
    </button>
  )
}

function SchemaSection({ schema, loading, error }: { schema: TableField[] | null; loading: boolean; error: string | null }) {
  const [filter, setFilter] = useState('')

  if (loading) return <div className="p-4 text-xs text-app-text-3 animate-pulse">Loading schema…</div>
  if (error) {
    return (
      <div className="p-4">
        <div className="bg-red-950/60 border border-red-900/60 rounded-lg p-3 text-xs font-mono text-red-400">{error}</div>
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

      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 bg-app-bg z-10">
          <tr>
            <th className="px-4 py-2 text-left text-app-text-2 font-medium border-b border-app-border w-1/3">Column</th>
            <th className="px-4 py-2 text-left text-app-text-2 font-medium border-b border-app-border w-1/5">Type</th>
            <th className="px-4 py-2 text-left text-app-text-2 font-medium border-b border-app-border w-1/6">Mode</th>
            <th className="px-4 py-2 text-left text-app-text-2 font-medium border-b border-app-border">Description</th>
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
                    <span className={row.field.mode === 'REQUIRED' ? 'text-amber-500' : 'text-app-accent-text'}>
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
        <div className="bg-red-950/60 border border-red-900/60 rounded-lg p-3 text-xs font-mono text-red-400">{error}</div>
        <button onClick={onRetry} className="text-xs text-app-accent-text hover:opacity-80 text-left">Retry</button>
      </div>
    )
  }
  if (!result) return null

  const { columns, rows, rowCount, executionTimeMs } = result

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-1.5 border-b border-app-border bg-app-surface shrink-0 sticky top-0 z-10">
        <span className="text-xs text-app-text-2">{rowCount} rows</span>
        <span className="text-xs text-app-text-3">{executionTimeMs}ms</span>
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

interface FlatField { field: TableField; depth: number }

function flattenFields(fields: TableField[], depth = 0): FlatField[] {
  const result: FlatField[] = []
  for (const f of fields) {
    result.push({ field: f, depth })
    if (f.fields?.length) result.push(...flattenFields(f.fields, depth + 1))
  }
  return result
}

function typeColor(type: string): string {
  switch (type.toUpperCase()) {
    case 'STRING': case 'BYTES': return 'text-emerald-400'
    case 'INTEGER': case 'INT64': case 'FLOAT': case 'FLOAT64':
    case 'NUMERIC': case 'BIGNUMERIC': return 'text-sky-400'
    case 'BOOLEAN': case 'BOOL': return 'text-amber-400'
    case 'TIMESTAMP': case 'DATE': case 'TIME': case 'DATETIME': return 'text-violet-400'
    case 'RECORD': case 'STRUCT': return 'text-app-accent-text'
    default: return 'text-app-text-2'
  }
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}


