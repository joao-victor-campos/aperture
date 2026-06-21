import type { WebContents } from 'electron'
import { CHANNELS } from '../../shared/ipc'
import type { QueryResult, TableField } from '../../shared/types'

export const QUERY_TIMEOUT_MS = 180_000
export const HEARTBEAT_INTERVAL_MS = 10_000

/** Single source of truth for the "Xm Ys" / "Ns" elapsed label. */
export function elapsed(startMs: number): string {
  const s = Math.round((Date.now() - startMs) / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

/** The isDestroyed()-guarded QUERY_LOG sender every adapter hand-rolls. */
export function makeLogger(webContents: WebContents, tabId: string): (msg: string) => void {
  return (message: string) => {
    if (!webContents.isDestroyed()) {
      webContents.send(CHANNELS.QUERY_LOG, { tabId, message })
    }
  }
}

/** Logs `Still running… Ns elapsed` every HEARTBEAT_INTERVAL_MS. Returns stop(). */
export function startHeartbeat(log: (m: string) => void, start: number): () => void {
  const timer = setInterval(() => log(`Still running… ${elapsed(start)} elapsed`), HEARTBEAT_INTERVAL_MS)
  return () => clearInterval(timer)
}

export interface RunningEntry {
  cancel: () => Promise<void>
  webContents: WebContents
}

/** Shared registry of in-flight queries, keyed by tabId (replaces 4 per-adapter maps). */
export const runningJobs = new Map<string, RunningEntry>()

/** Single cancel path for all engines. Adapters re-export this. */
export async function cancelRunningQuery(tabId: string): Promise<void> {
  const entry = runningJobs.get(tabId)
  if (!entry) return
  if (!entry.webContents.isDestroyed()) {
    entry.webContents.send(CHANNELS.QUERY_LOG, { tabId, message: 'Cancelled by user.' })
  }
  try {
    await entry.cancel()
  } catch {
    // ignore — query may have already completed
  }
  runningJobs.delete(tabId)
}

export interface LifecycleContext {
  log: (message: string) => void
  registerCancel: (thunk: () => Promise<void>) => void
}

/**
 * Full lifecycle wrapper for BigQuery / Snowflake / Neo4j.
 * Owns the heartbeat, 180s timeout race, idempotent cleanup, and registry
 * insert/delete. `execute` does the engine work and calls registerCancel(thunk)
 * the moment it holds its cancellable handle.
 */
export async function runWithLifecycle(opts: {
  tabId: string
  webContents: WebContents
  timeoutMessage: string
  execute: (ctx: LifecycleContext) => Promise<QueryResult>
}): Promise<QueryResult> {
  const { tabId, webContents, timeoutMessage, execute } = opts
  const start = Date.now()
  const log = makeLogger(webContents, tabId)

  let done = false
  const stopHeartbeat = startHeartbeat(log, start)
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null

  const cleanup = () => {
    if (done) return
    done = true
    stopHeartbeat()
    if (timeoutTimer) clearTimeout(timeoutTimer)
    runningJobs.delete(tabId)
  }

  const registerCancel = (thunk: () => Promise<void>) => {
    runningJobs.set(tabId, { cancel: thunk, webContents })
  }

  const workPromise = execute({ log, registerCancel })
    .then((result) => {
      cleanup()
      return result
    })
    .catch((err: Error) => {
      cleanup()
      throw err
    })

  // Prevent an unhandled rejection on the losing branch of the race.
  workPromise.catch(() => {})

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(async () => {
      log('Timeout reached (180s) · Cancelling…')
      const entry = runningJobs.get(tabId)
      if (entry) {
        try { await entry.cancel() } catch { /* ignore */ }
      }
      cleanup()
      reject(new Error(timeoutMessage))
    }, QUERY_TIMEOUT_MS)
  })

  return Promise.race([workPromise, timeoutPromise])
}

/** Main-process concurrency cap (twin of the renderer catalogStore helper). */
export async function runCapped<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!)
  })
  await Promise.all(workers)
}

/** The identical getDatasetColumns accumulator (dialect reading stays in accessor). */
export function groupColumnsByTable(
  rows: Record<string, unknown>[],
  accessor: (row: Record<string, unknown>) => { tableId: string; field: TableField },
): Record<string, TableField[]> {
  const out: Record<string, TableField[]> = {}
  for (const row of rows) {
    const { tableId, field } = accessor(row)
    ;(out[tableId] ??= []).push(field)
  }
  return out
}
