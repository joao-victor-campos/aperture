import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchApp, captureOnFailure } from '../helpers/app'
import { addPostgresConnection } from '../helpers/connectionModal'
import { PG_CONNECTION_NAME } from '../helpers/postgres'
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

  // Saved query came back
  await page.getByRole('button', { name: /Saved \d/ }).click()
  // Tabs are not persisted (StoreData has no tab/editor-state field — see
  // src/main/db/store.ts), so the fresh boot window has no "Persisted Query"
  // tab to collide with. A bare getByText matches only the sidebar row here.
  await expect(page.getByText('Persisted Query')).toBeVisible()
})
