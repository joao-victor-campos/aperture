import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'
import type { UpdateStatus } from '../../../shared/types'

// ── Capture ipcMain.handle registrations ────────────────────────────────────
type Handler = (event: unknown, req?: unknown) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
  },
  app: { getVersion: () => '2.3.0' },
}))

// ── Mock checkForUpdate ──────────────────────────────────────────────────────
const mockCheck = vi.fn()
vi.mock('../../../main/updates/checkForUpdate', () => ({
  checkForUpdate: (...args: unknown[]) => mockCheck(...args),
}))

import { registerUpdateHandlers, pushUpdateStatus } from '../../../main/ipc/updates'

function fakeStatus(): UpdateStatus {
  return {
    currentVersion: '2.3.0',
    latestVersion: '2.4.0',
    updateAvailable: true,
    dmgUrl: 'https://x/arm64.dmg',
    releaseUrl: 'https://x/release',
    releaseNotes: 'notes',
    publishedAt: '2026-06-18T00:00:00Z',
    checkedAt: '2026-06-18T00:00:00Z',
    error: null,
  }
}

beforeEach(() => {
  handlers.clear()
  mockCheck.mockReset()
})

describe('UPDATES_CHECK handler', () => {
  it('returns the checkForUpdate result using the app version', async () => {
    mockCheck.mockResolvedValue(fakeStatus())
    registerUpdateHandlers()

    const handler = handlers.get(CHANNELS.UPDATES_CHECK)!
    const result = await handler({})

    expect(mockCheck).toHaveBeenCalledWith('2.3.0', process.arch)
    expect(result).toEqual(fakeStatus())
  })
})

describe('pushUpdateStatus', () => {
  it('sends UPDATES_STATUS to a live window', async () => {
    mockCheck.mockResolvedValue(fakeStatus())
    const send = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send } }

    await pushUpdateStatus(win as never)

    expect(send).toHaveBeenCalledWith(CHANNELS.UPDATES_STATUS, fakeStatus())
  })

  it('is a no-op when the window is null', async () => {
    await pushUpdateStatus(null)
    expect(mockCheck).not.toHaveBeenCalled()
  })

  it('is a no-op when the window is destroyed', async () => {
    const send = vi.fn()
    const win = { isDestroyed: () => true, webContents: { send } }

    await pushUpdateStatus(win as never)

    expect(send).not.toHaveBeenCalled()
  })
})
