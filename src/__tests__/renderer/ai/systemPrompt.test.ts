import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../../../renderer/src/ai/systemPrompt'

describe('buildSystemPrompt', () => {
  it('names the active connection and engine', () => {
    const p = buildSystemPrompt('prod-warehouse', 'bigquery')
    expect(p).toContain('prod-warehouse')
    expect(p).toContain('bigquery')
  })

  it('mentions the confirmation rule for running queries', () => {
    const p = buildSystemPrompt('c', 'postgres')
    expect(p.toLowerCase()).toContain('run_query')
  })
})
