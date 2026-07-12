import { mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import type { TestInfo } from '@playwright/test'
import type { Connection } from '../../src/shared/types'

export interface LaunchResult {
  app: ElectronApplication
  page: Page
  userDataDir: string
}

/**
 * Launch the built app (out/main/index.js) with an isolated userData dir.
 * Run `npm run build` before the suite — this launches the build output, not the dev server.
 */
export async function launchApp(
  options: {
    /** Reuse an existing userData dir (relaunch scenario). Default: fresh temp dir. */
    userDataDir?: string
    /** Connections seeded into aperture-store.json before first launch. */
    seedConnections?: Connection[]
  } = {},
): Promise<LaunchResult> {
  const userDataDir = options.userDataDir ?? (await mkdtemp(join(tmpdir(), 'aperture-e2e-')))
  if (options.seedConnections) {
    // store.get() falls back to DEFAULTS per key, so a partial store file is valid.
    await writeFile(
      join(userDataDir, 'aperture-store.json'),
      JSON.stringify({ connections: options.seedConnections }, null, 2),
      'utf-8',
    )
  }
  const app = await _electron.launch({
    args: [
      resolve(__dirname, '../../out/main/index.js'),
      // Linux CI has no SUID chrome-sandbox helper; sandboxing isn't what E2E verifies.
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
    env: { ...(process.env as Record<string, string>), APERTURE_USER_DATA: userDataDir },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, userDataDir }
}

/** Attach a screenshot to the report when a test failed. Call from afterEach. */
export async function captureOnFailure(page: Page | undefined, testInfo: TestInfo): Promise<void> {
  if (!page || testInfo.status === testInfo.expectedStatus) return
  try {
    await testInfo.attach('failure-screenshot', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  } catch {
    // window may already be gone — nothing to capture
  }
}
