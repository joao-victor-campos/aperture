import { describe, it, expect } from 'vitest'
import { filterSortRows } from '../../../renderer/src/lib/filterSortRows'

type Row = Record<string, unknown>

const rows: Row[] = [
  { id: 1, name: 'Alice', score: 90 },
  { id: 2, name: 'Bob',   score: 70 },
  { id: 3, name: 'Carol', score: 85 },
  { id: 4, name: null,    score: null },
]

describe('filterSortRows', () => {
  describe('no filters and no sort', () => {
    it('returns rows unchanged', () => {
      const result = filterSortRows(rows, {}, null, 'asc')
      expect(result).toEqual(rows)
    })
  })

  describe('filtering', () => {
    it('filters by single column (case-insensitive substring)', () => {
      const result = filterSortRows(rows, { name: 'ali' }, null, 'asc')
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Alice')
    })

    it('multiple column filters are ANDed', () => {
      const result = filterSortRows(rows, { name: 'o', score: '7' }, null, 'asc')
      // Bob has name containing 'o' AND score 70 which contains '7'
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Bob')
    })

    it('empty filter string matches all rows', () => {
      const result = filterSortRows(rows, { name: '' }, null, 'asc')
      expect(result).toHaveLength(rows.length)
    })

    it('whitespace-only filter is treated as empty and matches all rows', () => {
      const result = filterSortRows(rows, { name: '   ' }, null, 'asc')
      expect(result).toHaveLength(rows.length)
    })

    it('null cell value does not match any non-empty filter', () => {
      const result = filterSortRows(rows, { name: 'null' }, null, 'asc')
      // The cell value is null, not the string "null"
      expect(result).toHaveLength(0)
    })
  })

  describe('sorting', () => {
    it('sorts ascending by string column', () => {
      const result = filterSortRows(rows, {}, 'name', 'asc')
      // null sorts last
      const names = result.map((r) => r.name)
      expect(names).toEqual(['Alice', 'Bob', 'Carol', null])
    })

    it('sorts descending by string column', () => {
      const result = filterSortRows(rows, {}, 'name', 'desc')
      const names = result.map((r) => r.name)
      expect(names).toEqual(['Carol', 'Bob', 'Alice', null])
    })

    it('sorts ascending by numeric column', () => {
      const result = filterSortRows(rows, {}, 'score', 'asc')
      const scores = result.map((r) => r.score)
      expect(scores).toEqual([70, 85, 90, null])
    })

    it('sorts descending by numeric column', () => {
      const result = filterSortRows(rows, {}, 'score', 'desc')
      const scores = result.map((r) => r.score)
      expect(scores).toEqual([90, 85, 70, null])
    })

    it('null values always sort last regardless of direction', () => {
      const result_asc = filterSortRows(rows, {}, 'score', 'asc')
      const result_desc = filterSortRows(rows, {}, 'score', 'desc')
      expect(result_asc[result_asc.length - 1].score).toBeNull()
      expect(result_desc[result_desc.length - 1].score).toBeNull()
    })
  })

  describe('combined filter + sort', () => {
    it('applies filter then sorts the filtered result', () => {
      const result = filterSortRows(rows, { name: 'o' }, 'score', 'desc')
      // 'o' matches Bob (70) and Carol (85)
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('Carol') // 85 > 70
      expect(result[1].name).toBe('Bob')
    })
  })
})
