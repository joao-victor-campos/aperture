import { useState, useEffect, useMemo } from 'react'
import { Copy, Check } from 'lucide-react'
import { CHANNELS } from '@shared/ipc'
import type { TableField, QueryResult } from '@shared/types'
import { useCatalogStore } from '../../store/catalogStore'

interface TableDetailPanelProps {
  connectionId: string
  projectId: string
  datasetId: string
  tableId: string
  tableName: string
}

type Section = 'schema' | 'preview'

export default function TableDetailPanel({
  connectionId,
  projectId,
  datasetId,
  tableId,
  tableName
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

  // Stable preview tab ID so logs from this preview are silently routed to a non-existent tab
  const previewTabId = useMemo(() => crypto.randomUUID(), [tableId, datasetId])

  const tableRef = `${datasetId}.${tableId}`
  const fullRef = `\`${projectId}.${datasetId}.${tableId}\``

  // Load schema on mount / when table changes
  useEffect(() => {
    setSchema(null)
    setSchemaError(null)
    setPreview(null)
    setPreviewLoaded(false)
    setSection('schema')
    setSchemaLoading(true)
    loadSchema(connectionId, projectId, datasetId, tableId)
      .then((fields) => {
        setSchema(fields)
        setSchemaLoading(false)
      })
      .catch((err: Error) => {
        setSchemaError(err.message)
        setSchemaLoading(false)
      })
  }, [connectionId, projectId, datasetId, tableId])

  // Load preview only when the user switches to that tab (lazy)
  const handleSectionClick = (s: Section) => {
    setSection(s)
    if (s === 'preview' && !previewLoaded && !previewLoading) {
      loadPreview()
    }
  }

  const loadPreview = async () => {
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const result = await window.api.invoke(CHANNELS.QUERY_EXECUTE, {
        connectionId,
        sql: `SELECT * FROM ${fullRef} LIMIT 50`,
        tabId: previewTabId
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
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-950 shrink-0">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-gray-200">{tableName}</span>
          <span className="text-[10px] text-gray-600 font-mono">{tableRef}</span>
        </div>
        <button
          onClick={handleCopy}
          title="Copy dataset.table reference"
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors border border-gray-700"
        >
          {copied ? (
            <>
              <Check size={12} className="text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>{tableRef}</span>
            </>
          )}
        </button>
      </div>

      {/* Section tabs */}
      <div className="flex border-b border-gray-800 bg-gray-950 shrink-0">
        <SectionTab label="Schema" active={section === 'schema'} onClick={() => handleSectionClick('schema')} />
        <SectionTab label="Preview" active={section === 'preview'} onClick={() => handleSectionClick('preview')} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {section === 'schema' && (
          <SchemaSection schema={schema} loading={schemaLoading} error={schemaError} />
        )}
        {section === 'preview' && (
          <PreviewSection
            result={preview}
            loading={previewLoading}
            error={previewError}
            onRetry={loadPreview}
          />
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionTab({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-xs transition-colors ${
        active
          ? 'text-indigo-400 border-b-2 border-indigo-500'
          : 'text-gray-500 hover:text-gray-300'
      }`}
    >
      {label}
    </button>
  )
}

function SchemaSection({
  schema,
  loading,
  error
}: {
  schema: TableField[] | null
  loading: boolean
  error: string | null
}) {
  if (loading) {
    return (
      <div className="p-4 text-xs text-gray-600 animate-pulse">Loading schema…</div>
    )
  }
  if (error) {
    return (
      <div className="p-4">
        <div className="bg-red-950/60 border border-red-900/60 rounded-lg p-3 text-xs font-mono text-red-400">
          {error}
        </div>
      </div>
    )
  }
  if (!schema || schema.length === 0) {
    return <div className="p-4 text-xs text-gray-600">No schema available.</div>
  }

  return (
    <table className="w-full text-xs border-collapse">
      <thead className="sticky top-0 bg-gray-900 z-10">
        <tr>
          <th className="px-4 py-2 text-left text-gray-400 font-medium border-b border-gray-800 w-1/3">Column</th>
          <th className="px-4 py-2 text-left text-gray-400 font-medium border-b border-gray-800 w-1/5">Type</th>
          <th className="px-4 py-2 text-left text-gray-400 font-medium border-b border-gray-800 w-1/6">Mode</th>
          <th className="px-4 py-2 text-left text-gray-400 font-medium border-b border-gray-800">Description</th>
        </tr>
      </thead>
      <tbody>
        {flattenFields(schema).map((row, i) => (
          <tr key={i} className={`hover:bg-gray-800/30 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}>
            <td className="px-4 py-2 font-mono text-gray-300 border-b border-gray-800/40">
              {row.depth > 0 && (
                <span className="text-gray-700 mr-1">{'  '.repeat(row.depth)}↳</span>
              )}
              {row.field.name}
            </td>
            <td className="px-4 py-2 font-mono border-b border-gray-800/40">
              <span className={typeColor(row.field.type)}>{row.field.type}</span>
            </td>
            <td className="px-4 py-2 text-gray-500 border-b border-gray-800/40">
              {row.field.mode !== 'NULLABLE' ? (
                <span className={row.field.mode === 'REQUIRED' ? 'text-amber-500' : 'text-indigo-400'}>
                  {row.field.mode}
                </span>
              ) : (
                <span className="text-gray-700">NULLABLE</span>
              )}
            </td>
            <td className="px-4 py-2 text-gray-600 border-b border-gray-800/40 max-w-xs truncate">
              {row.field.description ?? ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function PreviewSection({
  result,
  loading,
  error,
  onRetry
}: {
  result: QueryResult | null
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  if (loading) {
    return (
      <div className="p-4 text-xs text-gray-600 animate-pulse">Fetching preview…</div>
    )
  }
  if (error) {
    return (
      <div className="p-4 flex flex-col gap-3">
        <div className="bg-red-950/60 border border-red-900/60 rounded-lg p-3 text-xs font-mono text-red-400">
          {error}
        </div>
        <button
          onClick={onRetry}
          className="text-xs text-indigo-400 hover:text-indigo-300 text-left"
        >
          Retry
        </button>
      </div>
    )
  }
  if (!result) return null

  const { columns, rows, rowCount, executionTimeMs } = result

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-1.5 border-b border-gray-800 bg-gray-950 shrink-0 sticky top-0 z-10">
        <span className="text-xs text-gray-500">{rowCount} rows</span>
        <span className="text-xs text-gray-600">{executionTimeMs}ms</span>
      </div>
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-[33px] bg-gray-900 z-10">
          <tr>
            {columns.map((col) => (
              <th
                key={col}
                className="px-3 py-2 text-left text-gray-400 font-medium border-b border-gray-800 whitespace-nowrap"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={`hover:bg-gray-800/40 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-900/30'}`}
            >
              {columns.map((col) => (
                <td
                  key={col}
                  className="px-3 py-1.5 text-gray-300 font-mono border-b border-gray-800/40 whitespace-nowrap max-w-xs truncate"
                >
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

// ── Helpers ───────────────────────────────────────────────────────────────────

interface FlatField {
  field: TableField
  depth: number
}

function flattenFields(fields: TableField[], depth = 0): FlatField[] {
  const result: FlatField[] = []
  for (const f of fields) {
    result.push({ field: f, depth })
    if (f.fields?.length) {
      result.push(...flattenFields(f.fields, depth + 1))
    }
  }
  return result
}

function typeColor(type: string): string {
  switch (type.toUpperCase()) {
    case 'STRING':
    case 'BYTES':
      return 'text-emerald-400'
    case 'INTEGER':
    case 'INT64':
    case 'FLOAT':
    case 'FLOAT64':
    case 'NUMERIC':
    case 'BIGNUMERIC':
      return 'text-sky-400'
    case 'BOOLEAN':
    case 'BOOL':
      return 'text-amber-400'
    case 'TIMESTAMP':
    case 'DATE':
    case 'TIME':
    case 'DATETIME':
      return 'text-violet-400'
    case 'RECORD':
    case 'STRUCT':
      return 'text-indigo-400'
    default:
      return 'text-gray-400'
  }
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
