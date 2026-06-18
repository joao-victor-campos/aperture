import { describe, it, expect } from 'vitest'
import { selectDmgAsset } from '../../../main/updates/selectDmgAsset'

const assets = [
  { name: 'Aperture-2.4.0-arm64.dmg', browser_download_url: 'https://x/arm64.dmg' },
  { name: 'Aperture-2.4.0-x64.dmg', browser_download_url: 'https://x/x64.dmg' },
  { name: 'Aperture-2.4.0-arm64.dmg.blockmap', browser_download_url: 'https://x/map' },
]

describe('selectDmgAsset', () => {
  it('picks the arm64 DMG for arm64', () => {
    expect(selectDmgAsset(assets, 'arm64')).toBe('https://x/arm64.dmg')
  })

  it('picks the x64 DMG for x64', () => {
    expect(selectDmgAsset(assets, 'x64')).toBe('https://x/x64.dmg')
  })

  it('returns null when no asset matches the arch', () => {
    expect(selectDmgAsset(assets, 'ppc64')).toBeNull()
  })

  it('returns null for an empty asset list', () => {
    expect(selectDmgAsset([], 'arm64')).toBeNull()
  })
})
