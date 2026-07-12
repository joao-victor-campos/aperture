import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchApp, captureOnFailure } from '../helpers/app'
import { seededPgConnection } from '../helpers/postgres'
import { bindTabToConnection, typeSql } from '../helpers/editor'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp({ seedConnections: [seededPgConnection()] }))
})

test.afterEach(async ({}, testInfo) => {
  await captureOnFailure(page, testInfo)
  await app?.close()
})

test('runs a query against the seeded database and renders rows', async () => {
  await bindTabToConnection(page)
  // LIMIT included so the auto-limit guard never interposes
  await typeSql(page, 'SELECT id, name FROM customers ORDER BY id LIMIT 5')

  await page.getByRole('button', { name: /Run/ }).click()

  // Results toolbar row count + a known cell from the seeded data
  await expect(page.getByText('5 rows')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Customer 3', { exact: true })).toBeVisible()
})
