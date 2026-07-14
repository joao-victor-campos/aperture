/**
 * formatIndexStatus.test.ts
 * Tests the pure indexed-state → status-line formatter (src/renderer/src/lib/formatIndexStatus.ts).
 */
import { describe, it, expect } from 'vitest'
import { formatIndexStatus } from '../../../renderer/src/lib/formatIndexStatus'

describe('formatIndexStatus', () => {
  it('shows live progress while warming', () => {
    expect(
      formatIndexStatus({ phase: 'warming', datasetsDone: 12, datasetsTotal: 42 })
    ).toBe('Indexing catalog… 12/42')
  })

  it('summarizes a clean warmed index with counts and the local completion time', () => {
    // 09:41 local time — constructed in local time so the test is timezone-stable
    const indexedAt = new Date(2026, 6, 14, 9, 41).getTime()
    expect(
      formatIndexStatus({
        phase: 'warmed',
        indexedAt,
        datasetCount: 42,
        tableCount: 730,
        failedDatasets: [],
      })
    ).toBe('Indexed 42 datasets · 730 tables · 09:41')
  })

  it('uses singular nouns for single counts', () => {
    const indexedAt = new Date(2026, 6, 14, 17, 5).getTime()
    expect(
      formatIndexStatus({
        phase: 'warmed',
        indexedAt,
        datasetCount: 1,
        tableCount: 1,
        failedDatasets: [],
      })
    ).toBe('Indexed 1 dataset · 1 table · 17:05')
  })

  it('appends the failed-dataset count when the warm-up left failures', () => {
    const indexedAt = new Date(2026, 6, 14, 9, 41).getTime()
    expect(
      formatIndexStatus({
        phase: 'warmed',
        indexedAt,
        datasetCount: 40,
        tableCount: 700,
        failedDatasets: [
          { id: 'ds9', name: 'ds9', error: 'permission denied' },
          { id: 'ds12', name: 'ds12', error: 'region unavailable' },
        ],
      })
    ).toBe('Indexed 40 datasets · 700 tables · 09:41 · 2 failed')
  })

  it('states the failure when the catalog could not be indexed at all', () => {
    expect(formatIndexStatus({ phase: 'failed', error: 'connection refused' })).toBe(
      'Catalog indexing failed'
    )
  })

  it('returns null when the connection was never warmed (idle)', () => {
    expect(formatIndexStatus(undefined)).toBeNull()
  })

  it('omits the progress counts while the dataset list is still loading (total 0)', () => {
    expect(formatIndexStatus({ phase: 'warming', datasetsDone: 0, datasetsTotal: 0 })).toBe(
      'Indexing catalog…'
    )
  })
})
