import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'

vi.mock('electron', () => ({}))

import {
  elapsed, makeLogger, startHeartbeat, runningJobs, cancelRunningQuery,
  runWithLifecycle, runCapped, groupColumnsByTable,
  HEARTBEAT_INTERVAL_MS, QUERY_TIMEOUT_MS,
} from '../../../main/db/queryRuntime'
import type { QueryResult, TableField } from '../../../shared/types'

const makeWC = () => ({ send: vi.fn(), isDestroyed: vi.fn(() => false) })

beforeEach(() => {
  runningJobs.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('elapsed', () => {
  it('formats sub-minute as seconds', () => {
    const t = Date.now() - 5_000
    expect(elapsed(t)).toMatch(/^[45]s$/)
  })
  it('formats over a minute as "Xm Ys"', () => {
    const t = Date.now() - 65_000
    expect(elapsed(t)).toMatch(/^1m [45]s$/)
  })
})

describe('makeLogger', () => {
  it('sends QUERY_LOG when the webContents is alive', () => {
    const wc = makeWC()
    makeLogger(wc as never, 'tab1')('hello')
    expect(wc.send).toHaveBeenCalledWith(CHANNELS.QUERY_LOG, { tabId: 'tab1', message: 'hello' })
  })
  it('does not send when the webContents is destroyed', () => {
    const wc = { send: vi.fn(), isDestroyed: vi.fn(() => true) }
    makeLogger(wc as never, 'tab1')('hello')
    expect(wc.send).not.toHaveBeenCalled()
  })
})

describe('startHeartbeat', () => {
  it('logs on each interval until stopped', () => {
    vi.useFakeTimers()
    const log = vi.fn()
    const stop = startHeartbeat(log, Date.now())
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2)
    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[0][0]).toMatch(/^Still running… .* elapsed$/)
    stop()
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2)
    expect(log).toHaveBeenCalledTimes(2)
  })
})

describe('runCapped', () => {
  it('runs every item and never exceeds the concurrency cap', async () => {
    let active = 0
    let maxActive = 0
    const seen: number[] = []
    await runCapped([1, 2, 3, 4, 5, 6, 7], 2, async (n) => {
      active++; maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      seen.push(n); active--
    })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(maxActive).toBeLessThanOrEqual(2)
  })
  it('handles an empty list', async () => {
    const fn = vi.fn()
    await runCapped([], 5, fn)
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('groupColumnsByTable', () => {
  it('groups fields by table id preserving order', () => {
    const rows = [
      { t: 'a', c: 'id' }, { t: 'a', c: 'name' }, { t: 'b', c: 'x' },
    ]
    const out = groupColumnsByTable(rows, (r) => ({
      tableId: r.t as string,
      field: { name: r.c as string, type: 'STRING', mode: 'NULLABLE' } as TableField,
    }))
    expect(Object.keys(out)).toEqual(['a', 'b'])
    expect(out.a.map((f) => f.name)).toEqual(['id', 'name'])
    expect(out.b.map((f) => f.name)).toEqual(['x'])
  })
  it('returns {} for empty input', () => {
    expect(groupColumnsByTable([], () => ({ tableId: 'x', field: {} as TableField }))).toEqual({})
  })
})

describe('runWithLifecycle', () => {
  const okResult: QueryResult = { columns: ['a'], rows: [{ a: 1 }], rowCount: 1, executionTimeMs: 0 }

  it('resolves with the execute result and cleans up the registry', async () => {
    const wc = makeWC()
    const result = await runWithLifecycle({
      tabId: 'ok', webContents: wc as never, timeoutMessage: 'timed out',
      execute: async ({ registerCancel }) => { registerCancel(async () => {}); return okResult },
    })
    expect(result).toEqual(okResult)
    expect(runningJobs.has('ok')).toBe(false)
  })

  it('propagates execute errors and cleans up', async () => {
    const wc = makeWC()
    await expect(runWithLifecycle({
      tabId: 'err', webContents: wc as never, timeoutMessage: 'timed out',
      execute: async () => { throw new Error('boom') },
    })).rejects.toThrow('boom')
    expect(runningJobs.has('err')).toBe(false)
  })

  it('on timeout invokes the registered cancel and rejects with timeoutMessage', async () => {
    vi.useFakeTimers()
    const wc = makeWC()
    const cancel = vi.fn(async () => {})
    const p = runWithLifecycle({
      tabId: 'to', webContents: wc as never, timeoutMessage: 'Query timed out after 180 seconds.',
      execute: async ({ registerCancel }) => {
        registerCancel(cancel)
        return new Promise<QueryResult>(() => {}) // never resolves
      },
    })
    const assertion = expect(p).rejects.toThrow('Query timed out after 180 seconds.')
    await vi.advanceTimersByTimeAsync(QUERY_TIMEOUT_MS)
    await assertion
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(runningJobs.has('to')).toBe(false)
  })
})

describe('cancelRunningQuery', () => {
  it('is a no-op when no query is registered', async () => {
    await expect(cancelRunningQuery('absent')).resolves.toBeUndefined()
  })
  it('logs, invokes the cancel thunk, and deletes the entry', async () => {
    const wc = makeWC()
    const cancel = vi.fn(async () => {})
    runningJobs.set('live', { cancel, webContents: wc as never })
    await cancelRunningQuery('live')
    expect(wc.send).toHaveBeenCalledWith(CHANNELS.QUERY_LOG, { tabId: 'live', message: 'Cancelled by user.' })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(runningJobs.has('live')).toBe(false)
  })
  it('skips send when webContents is destroyed, but still invokes cancel and deletes', async () => {
    const wc = { send: vi.fn(), isDestroyed: vi.fn(() => true) }
    const cancel = vi.fn(async () => {})
    runningJobs.set('destroyed', { cancel, webContents: wc as never })
    await cancelRunningQuery('destroyed')
    expect(wc.send).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(runningJobs.has('destroyed')).toBe(false)
  })
})
