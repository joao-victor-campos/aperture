import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { launchApp, captureOnFailure } from '../helpers/app'
import { addPostgresConnection } from '../helpers/connectionModal'
import { PG, PG_CONNECTION_NAME, seededPgConnection } from '../helpers/postgres'
import { bindTabToConnection, typeSql, saveCurrentQuery } from '../helpers/editor'

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeEach(async () => {
  ;({ app, page, userDataDir } = await launchApp())
})

test.afterEach(async ({}, testInfo) => {
  await captureOnFailure(page, testInfo)
  await app?.close()
})

/** Ask the live main process whether safeStorage encryption is available. */
async function encryptionAvailable(electronApp: ElectronApplication): Promise<boolean> {
  return electronApp.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable())
}

async function readStore(dir: string): Promise<{ connections: Array<{ password?: string }> }> {
  return JSON.parse(await readFile(join(dir, 'aperture-store.json'), 'utf-8'))
}

test('connections and saved queries survive an app relaunch', async () => {
  // Create everything through the real UI (writes aperture-store.json via IPC)
  await addPostgresConnection(page)
  await bindTabToConnection(page)
  await typeSql(page, 'SELECT 42 AS persisted')
  await saveCurrentQuery(page, 'Persisted Query')

  // Full process restart against the same userData dir
  await app.close()
  ;({ app, page } = await launchApp({ userDataDir }))

  // Connection came back and is active — scoped to the title-bar breadcrumb button
  // (bare getByText(PG_CONNECTION_NAME) also matches the per-tab connection
  // picker's <option>, which violates Playwright strict mode; see connect.spec.ts).
  await expect(
    page.getByRole('button', { name: `postgres / ${PG_CONNECTION_NAME}` }),
  ).toBeVisible({ timeout: 15_000 })

  // The health dot turning green proves the password decrypted back to a
  // working credential after the restart — the full encrypt→disk→decrypt cycle.
  await expect(page.locator('.app-dot--ok').first()).toBeVisible({ timeout: 15_000 })

  // Saved query came back
  await page.getByRole('button', { name: /Saved \d/ }).click()
  // Tabs are not persisted (StoreData has no tab/editor-state field — see
  // src/main/db/store.ts), so the fresh boot window has no "Persisted Query"
  // tab to collide with. A bare getByText matches only the sidebar row here.
  await expect(page.getByText('Persisted Query')).toBeVisible()

  // At-rest check: with encryption available the on-disk password is an
  // enc:v1: envelope; without it (some Linux setups) it stays plaintext.
  const store = await readStore(userDataDir)
  const password = store.connections[0]?.password ?? ''
  if (await encryptionAvailable(app)) {
    expect(password.startsWith('enc:v1:')).toBe(true)
  } else {
    expect(password).toBe(PG.password)
  }
})

test('migrates a legacy plaintext store on first boot', async () => {
  // The beforeEach app has an empty store — replace it with a launch seeded
  // by a PLAINTEXT store file, exactly what a pre-encryption version wrote.
  await app.close()
  ;({ app, page, userDataDir } = await launchApp({ seedConnections: [seededPgConnection()] }))

  // The migrated connection loads and its decrypted password still connects.
  await expect(
    page.getByRole('button', { name: `postgres / ${PG_CONNECTION_NAME}` }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.app-dot--ok').first()).toBeVisible({ timeout: 15_000 })

  const store = await readStore(userDataDir)
  const password = store.connections[0]?.password ?? ''
  if (await encryptionAvailable(app)) {
    // File was re-persisted encrypted…
    expect(password.startsWith('enc:v1:')).toBe(true)
    // …and the one-time backup preserves the pre-migration plaintext.
    const bak = JSON.parse(
      await readFile(join(userDataDir, 'aperture-store.json.bak'), 'utf-8'),
    ) as { connections: Array<{ password?: string }> }
    expect(bak.connections[0]?.password).toBe(PG.password)
  } else {
    // Encryption unavailable: migration is skipped by design; no .bak, plaintext stays.
    expect(password).toBe(PG.password)
  }
})
