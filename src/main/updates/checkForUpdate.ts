import { compareSemver } from './compareSemver'
import { selectDmgAsset, type GithubAsset } from './selectDmgAsset'
import type { UpdateStatus } from '../../shared/types'

export const GITHUB_REPO = 'joao-victor-campos/aperture'
const RELEASES_LATEST_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

interface GithubRelease {
  tag_name: string
  html_url: string
  body: string | null
  published_at: string
  assets: GithubAsset[]
}

/**
 * Checks GitHub's /releases/latest (which excludes drafts and prereleases) for a
 * version newer than `currentVersion`. Never throws — failures resolve to an
 * UpdateStatus with `error` set so the scheduler can swallow them silently.
 *
 * @param currentVersion app.getVersion()
 * @param arch process.arch ('arm64' | 'x64')
 */
export async function checkForUpdate(currentVersion: string, arch: string): Promise<UpdateStatus> {
  const checkedAt = new Date().toISOString()
  try {
    const res = await fetch(RELEASES_LATEST_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) {
      return errorStatus(currentVersion, checkedAt, `GitHub responded ${res.status}`)
    }
    const release = (await res.json()) as GithubRelease
    const latestVersion = release.tag_name
    const updateAvailable = compareSemver(latestVersion, currentVersion) === 1
    return {
      currentVersion,
      latestVersion,
      updateAvailable,
      dmgUrl: updateAvailable ? selectDmgAsset(release.assets ?? [], arch) : null,
      releaseUrl: release.html_url ?? null,
      releaseNotes: release.body ?? null,
      publishedAt: release.published_at ?? null,
      checkedAt,
      error: null,
    }
  } catch (err) {
    return errorStatus(currentVersion, checkedAt, err instanceof Error ? err.message : String(err))
  }
}

function errorStatus(currentVersion: string, checkedAt: string, error: string): UpdateStatus {
  return {
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    dmgUrl: null,
    releaseUrl: null,
    releaseNotes: null,
    publishedAt: null,
    checkedAt,
    error,
  }
}
