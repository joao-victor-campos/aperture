import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchApp, captureOnFailure } from '../helpers/app'
import { seededPgConnection } from '../helpers/postgres'
import { bindTabToConnection, typeSql, saveCurrentQuery } from '../helpers/editor'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp({ seedConnections: [seededPgConnection()] }))
})

test.afterEach(async ({}, testInfo) => {
  await captureOnFailure(page, testInfo)
  await app?.close()
})

test('saves a query and reopens it from the Saved panel', async () => {
  await bindTabToConnection(page)
  await typeSql(page, 'SELECT 1 AS smoke_check')

  await saveCurrentQuery(page, 'E2E Smoke Query')

  // Toolbar button flips to its "saved" state
  await expect(page.getByTitle('Update saved query (⌘S)')).toBeVisible()

  // Sidebar segmented tab shows the count ("Saved 1") — regex keeps it distinct
  // from the editor toolbar's "Saved" button
  await page.getByRole('button', { name: /Saved \d/ }).click()
  // The just-saved tab's title already reads "E2E Smoke Query" in the tab strip
  // (SaveQueryModal renames it on save), so a bare getByText already has 2
  // matches here. The sidebar row is the only one with a `title` attribute
  // (SavedQueriesPanel's QueryRow sets title={query.title} for the truncation
  // tooltip), so getByTitle disambiguates it from the tab strip.
  await page.getByTitle('E2E Smoke Query').click()

  // The saved query opened as a NEW tab (SavedQueriesPanel.handleOpenQuery
  // always calls openTab — it does not dedup against an already-open tab for
  // the same savedQueryId). The originally-saved tab is still open too (its
  // title was renamed to "E2E Smoke Query" by SaveQueryModal on save), so the
  // title now appears 3 times: the original tab, the newly opened tab, and
  // the sidebar row.
  await expect(page.getByText('E2E Smoke Query')).toHaveCount(3)
  await expect(page.locator('.cm-content')).toContainText('SELECT 1 AS smoke_check')
})
