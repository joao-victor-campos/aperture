import { useMemo } from 'react'
import {
  BarChart, Bar, LineChart, Line, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { Table2 } from 'lucide-react'
import type { QueryResult, ChartConfig, ChartAggregate } from '@shared/types'
import { aggregateForChart } from '../../lib/aggregateForChart'

interface ChartViewProps {
  result: QueryResult
  config: ChartConfig
  onConfigChange: (partial: Partial<ChartConfig>) => void
  /** Switch back to the data table. */
  onShowTable: () => void
}

const CHART_TYPES: ChartConfig['type'][] = ['bar', 'line', 'scatter']
const AGGREGATES: ChartAggregate[] = ['none', 'sum', 'avg', 'count', 'min', 'max']
const ACCENT = 'rgb(196,102,58)' // terracotta — matches --c-accent

export default function ChartView({ result, config, onConfigChange, onShowTable }: ChartViewProps) {
  const data = useMemo(
    () => aggregateForChart(result.rows, config.xCol, config.yCol, config.aggregate),
    [result.rows, config.xCol, config.yCol, config.aggregate],
  )

  const axisProps = { stroke: 'rgb(120,112,104)', fontSize: 11 }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-app-border bg-app-surface shrink-0 flex-wrap">
        <button
          onClick={onShowTable}
          title="Back to table"
          className="flex items-center gap-1 text-xs px-2 py-0.5 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated transition-colors border border-app-border"
        >
          <Table2 size={11} /> Table
        </button>

        <div className="app-segmented" style={{ display: 'inline-flex' }}>
          {CHART_TYPES.map((t) => (
            <button key={t} data-active={config.type === t || undefined} onClick={() => onConfigChange({ type: t })}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <Selector label="X" value={config.xCol} options={result.columns} onChange={(v) => onConfigChange({ xCol: v })} />
        <Selector label="Y" value={config.yCol} options={result.columns} onChange={(v) => onConfigChange({ yCol: v })} />
        <Selector
          label="Aggregate"
          value={config.aggregate}
          options={AGGREGATES}
          onChange={(v) => onConfigChange({ aggregate: v as ChartAggregate })}
          accent
        />
      </div>

      {/* Canvas */}
      <div className="flex-1 min-h-0 p-3 bg-app-bg">
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-app-text-3 text-sm">
            No chartable data for this X/Y selection
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {config.type === 'bar' ? (
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(58,52,46)" />
                <XAxis dataKey="x" {...axisProps} />
                <YAxis {...axisProps} />
                <Tooltip contentStyle={{ background: 'rgb(33,29,25)', border: '1px solid rgb(58,52,46)', fontSize: 12 }} />
                <Bar dataKey="y" fill={ACCENT} />
              </BarChart>
            ) : config.type === 'line' ? (
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(58,52,46)" />
                <XAxis dataKey="x" {...axisProps} />
                <YAxis {...axisProps} />
                <Tooltip contentStyle={{ background: 'rgb(33,29,25)', border: '1px solid rgb(58,52,46)', fontSize: 12 }} />
                <Line type="monotone" dataKey="y" stroke={ACCENT} dot={false} />
              </LineChart>
            ) : (
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(58,52,46)" />
                <XAxis dataKey="x" {...axisProps} />
                <YAxis dataKey="y" {...axisProps} />
                <Tooltip contentStyle={{ background: 'rgb(33,29,25)', border: '1px solid rgb(58,52,46)', fontSize: 12 }} />
                <Scatter data={data} fill={ACCENT} />
              </ScatterChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

function Selector({
  label, value, options, onChange, accent,
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (v: string) => void
  accent?: boolean
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-app-text-3">
      <span className="app-section-label">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`bg-app-elevated text-app-text text-xs rounded px-1.5 py-0.5 border focus:outline-none cursor-pointer ${
          accent ? 'border-app-accent/50 text-app-accent-text' : 'border-app-border focus:border-app-accent'
        }`}
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  )
}
