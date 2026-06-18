import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '@shared/ipc'
import type { UpdateStatus } from '@shared/types'
import { useUpdateStore, applyUpdateStatusPush } from '../../../renderer/src/store/updateStore'

function fakeStatus(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
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
    ...overrides,
  }
}

beforeEach(() => {
  useUpdateStore.setState({ status: null, checking: false })
  vi.mocked(window.api.invoke).mockReset()
})

describe('updateStore.checkNow', () => {
  it('stores the status on success', async () => {
    vi.mocked(window.api.invoke).mockResolvedValue(fakeStatus())

    await useUpdateStore.getState().checkNow()

    expect(window.api.invoke).toHaveBeenCalledWith(CHANNELS.UPDATES_CHECK, undefined)
    expect(useUpdateStore.getState().status?.latestVersion).toBe('2.4.0')
    expect(useUpdateStore.getState().checking).toBe(false)
  })

  it('records an error status when the invoke rejects', async () => {
    useUpdateStore.setState({ status: fakeStatus({ currentVersion: '2.3.0' }) })
    vi.mocked(window.api.invoke).mockRejectedValue(new Error('boom'))

    await useUpdateStore.getState().checkNow()

    const s = useUpdateStore.getState().status!
    expect(s.error).toBe('boom')
    expect(s.updateAvailable).toBe(false)
    expect(s.currentVersion).toBe('2.3.0') // preserved from prior status
    expect(useUpdateStore.getState().checking).toBe(false)
  })
})

describe('updateStore UPDATES_STATUS push listener', () => {
  it('applies a pushed status to the store', () => {
    // applyUpdateStatusPush is the exported listener body. We test it directly
    // rather than retrieving the import-time window.api.on callback, because the
    // project's vitest config sets clearMocks:true (it wipes mock.calls before
    // each test, so the import-time registration call is not retrievable here).
    applyUpdateStatusPush(fakeStatus({ latestVersion: '2.5.0' }))

    expect(useUpdateStore.getState().status?.latestVersion).toBe('2.5.0')
  })
})
