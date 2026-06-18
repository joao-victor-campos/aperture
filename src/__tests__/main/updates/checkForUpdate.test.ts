import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkForUpdate } from '../../../main/updates/checkForUpdate'

function release(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'v2.4.0',
    html_url: 'https://github.com/joao-victor-campos/aperture/releases/tag/v2.4.0',
    body: 'Release notes here',
    published_at: '2026-06-18T00:00:00Z',
    assets: [
      { name: 'Aperture-2.4.0-arm64.dmg', browser_download_url: 'https://x/arm64.dmg' },
      { name: 'Aperture-2.4.0-x64.dmg', browser_download_url: 'https://x/x64.dmg' },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('checkForUpdate', () => {
  it('reports an update with the arch-matched DMG when latest is newer', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => release(),
    })

    const status = await checkForUpdate('2.3.0', 'arm64')

    expect(status.updateAvailable).toBe(true)
    expect(status.latestVersion).toBe('v2.4.0')
    expect(status.dmgUrl).toBe('https://x/arm64.dmg')
    expect(status.releaseUrl).toContain('/releases/tag/v2.4.0')
    expect(status.releaseNotes).toBe('Release notes here')
    expect(status.error).toBeNull()
    expect(status.currentVersion).toBe('2.3.0')
    expect(fetch).toHaveBeenCalledWith('https://api.github.com/repos/joao-victor-campos/aperture/releases/latest', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Aperture/2.3.0' } })
  })

  it('reports no update when already on the latest', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => release(),
    })

    const status = await checkForUpdate('2.4.0', 'arm64')

    expect(status.updateAvailable).toBe(false)
    expect(status.dmgUrl).toBeNull()
    expect(status.error).toBeNull()
  })

  it('leaves dmgUrl null when no asset matches the arch but an update exists', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => release({ assets: [] }),
    })

    const status = await checkForUpdate('2.3.0', 'arm64')

    expect(status.updateAvailable).toBe(true)
    expect(status.dmgUrl).toBeNull()
    expect(status.releaseUrl).toContain('/releases/tag/v2.4.0')
  })

  it('returns an error status on a non-200 response', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    })

    const status = await checkForUpdate('2.3.0', 'arm64')

    expect(status.updateAvailable).toBe(false)
    expect(status.latestVersion).toBeNull()
    expect(status.currentVersion).toBe('2.3.0')
    expect(status.error).toContain('403')
  })

  it('returns an error status on a network failure', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'))

    const status = await checkForUpdate('2.3.0', 'arm64')

    expect(status.updateAvailable).toBe(false)
    expect(status.error).toBe('offline')
  })

  it('maps a null release body to null releaseNotes', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => release({ body: null }),
    })
    const status = await checkForUpdate('2.3.0', 'arm64')
    expect(status.releaseNotes).toBeNull()
  })

  it('returns an error status when the payload is missing tag_name', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ html_url: 'x', assets: [] }),
    })
    const status = await checkForUpdate('2.3.0', 'arm64')
    expect(status.updateAvailable).toBe(false)
    expect(status.error).toContain('tag_name')
  })
})
