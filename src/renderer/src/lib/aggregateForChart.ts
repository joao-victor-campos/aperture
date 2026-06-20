import type { ChartAggregate } from '@shared/types'

export interface ChartDatum {
  x: string
  y: number
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
    return Number((v as Record<string, unknown>).value)
  }
  return Number(v)
}

function toLabel(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
    const inner = (v as Record<string, unknown>).value
    if (typeof inner === 'string') return inner
  }
  return String(v)
}

/**
 * Build chart-ready { x, y } data from result rows.
 * - aggregate === 'none': one datum per row (rows with non-numeric Y are dropped).
 * - otherwise: group rows by X (first-seen order preserved) and reduce Y per group.
 *   COUNT counts rows; SUM/AVG/MIN/MAX ignore non-numeric Y values.
 */
export function aggregateForChart(
  rows: Record<string, unknown>[],
  xCol: string,
  yCol: string,
  aggregate: ChartAggregate,
): ChartDatum[] {
  if (aggregate === 'none') {
    return rows
      .map((r) => ({ x: toLabel(r[xCol]), y: toNum(r[yCol]) }))
      .filter((d) => Number.isFinite(d.y))
  }

  const groups = new Map<string, number[]>()
  for (const r of rows) {
    const key = toLabel(r[xCol])
    if (!groups.has(key)) groups.set(key, [])
    if (aggregate === 'count') {
      groups.get(key)!.push(1)
    } else {
      const n = toNum(r[yCol])
      if (Number.isFinite(n)) groups.get(key)!.push(n)
    }
  }

  const reduce = (vals: number[]): number => {
    if (aggregate === 'count') return vals.length
    if (vals.length === 0) return 0
    switch (aggregate) {
      case 'sum': return vals.reduce((a, b) => a + b, 0)
      case 'avg': return vals.reduce((a, b) => a + b, 0) / vals.length
      case 'min': return Math.min(...vals)
      case 'max': return Math.max(...vals)
      default: return 0
    }
  }

  return Array.from(groups.entries()).map(([x, vals]) => ({ x, y: reduce(vals) }))
}
