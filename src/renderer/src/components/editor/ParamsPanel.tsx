import type { QueryParam } from '@shared/types'

interface ParamsPanelProps {
  params: QueryParam[]
  onChange: (next: QueryParam[]) => void
}

const TYPES: QueryParam['type'][] = ['text', 'number', 'boolean', 'raw']

/**
 * Inputs row for {{name}} query parameters. Renders one row per param with a
 * type selector and a value input; emits the full updated array on every edit.
 */
export default function ParamsPanel({ params, onChange }: ParamsPanelProps) {
  const update = (name: string, patch: Partial<QueryParam>) =>
    onChange(params.map((p) => (p.name === name ? { ...p, ...patch } : p)))

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 bg-app-accent-subtle/30 border-b border-app-border shrink-0">
      <span className="app-section-label">Parameters</span>
      <div className="flex flex-col gap-1.5">
        {params.map((p) => (
          <div key={p.name} className="flex items-center gap-2">
            <code className="text-xs text-app-accent-text font-tabular shrink-0 w-40 truncate">
              {`{{${p.name}}}`}
            </code>
            <select
              value={p.type}
              onChange={(e) => {
                const type = e.target.value as QueryParam['type']
                update(p.name, type === 'boolean' && p.value.trim() === '' ? { type, value: 'true' } : { type })
              }}
              className="text-xs px-1.5 py-1 rounded border border-app-border bg-app-surface text-app-text-2 focus:ring-1 focus:ring-app-accent/30 outline-none"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {p.type === 'boolean' ? (
              <select
                value={p.value || 'true'}
                onChange={(e) => update(p.name, { value: e.target.value })}
                className="flex-1 text-xs px-2 py-1 rounded border border-app-border bg-app-surface text-app-text focus:ring-1 focus:ring-app-accent/30 outline-none"
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                type="text"
                value={p.value}
                onChange={(e) => update(p.name, { value: e.target.value })}
                placeholder={p.type === 'raw' ? 'raw SQL (inserted verbatim)' : `value for ${p.name}`}
                className="flex-1 text-xs px-2 py-1 rounded border border-app-border bg-app-surface text-app-text placeholder:text-app-text-3 focus:ring-1 focus:ring-app-accent/30 outline-none"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
