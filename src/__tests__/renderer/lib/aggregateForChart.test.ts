import { describe, it, expect } from 'vitest'
import { aggregateForChart } from '../../../renderer/src/lib/aggregateForChart'

const rows = [
  { month: 'Jan', revenue: 10 },
  { month: 'Jan', revenue: 30 },
  { month: 'Feb', revenue: 20 },
]

describe('aggregateForChart', () => {
  it('aggregate "none" plots one point per row, dropping non-numeric Y', () => {
    const out = aggregateForChart(
      [{ x: 'a', y: 1 }, { x: 'b', y: 'oops' }, { x: 'c', y: 3 }],
      'x', 'y', 'none',
    )
    expect(out).toEqual([{ x: 'a', y: 1 }, { x: 'c', y: 3 }])
  })

  it('SUM groups by X and sums Y, preserving first-seen order', () => {
    expect(aggregateForChart(rows, 'month', 'revenue', 'sum')).toEqual([
      { x: 'Jan', y: 40 },
      { x: 'Feb', y: 20 },
    ])
  })

  it('AVG averages Y per group', () => {
    expect(aggregateForChart(rows, 'month', 'revenue', 'avg')).toEqual([
      { x: 'Jan', y: 20 },
      { x: 'Feb', y: 20 },
    ])
  })

  it('COUNT counts rows per group regardless of Y value', () => {
    const withNulls = [...rows, { month: 'Jan', revenue: null }]
    expect(aggregateForChart(withNulls, 'month', 'revenue', 'count')).toEqual([
      { x: 'Jan', y: 3 },
      { x: 'Feb', y: 1 },
    ])
  })

  it('MIN and MAX reduce Y per group', () => {
    expect(aggregateForChart(rows, 'month', 'revenue', 'min')).toEqual([
      { x: 'Jan', y: 10 },
      { x: 'Feb', y: 20 },
    ])
    expect(aggregateForChart(rows, 'month', 'revenue', 'max')).toEqual([
      { x: 'Jan', y: 30 },
      { x: 'Feb', y: 20 },
    ])
  })

  it('unwraps BigQuery { value } objects for both X labels and Y numbers', () => {
    const bq = [{ d: { value: '2024-01' }, n: { value: '5' } }]
    expect(aggregateForChart(bq, 'd', 'n', 'sum')).toEqual([{ x: '2024-01', y: 5 }])
  })
})
