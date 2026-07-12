import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchApp, captureOnFailure } from '../helpers/app'
import { seededPgConnection } from '../helpers/postgres'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp({ seedConnections: [seededPgConnection()] }))
})

test.afterEach(async ({}, testInfo) => {
  await captureOnFailure(page, testInfo)
  await app?.close()
})

test('browses the seeded schema and opens a table detail panel', async () => {
  // Seeded connection is active after boot
  await expect(page.getByRole('button', { name: 'postgres / E2E Postgres' })).toBeVisible({
    timeout: 15_000,
  })

  // The "public" schema appears as a dataset once the catalog loads
  const publicDataset = page.getByRole('button', { name: 'public', exact: true })
  await expect(publicDataset).toBeVisible({ timeout: 15_000 })
  await publicDataset.click()

  // Seeded tables are listed
  await expect(page.getByRole('button', { name: 'customers', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'orders', exact: true })).toBeVisible()

  // Clicking a table opens its detail panel — schema section lists the seeded columns
  await page.getByRole('button', { name: 'customers', exact: true }).click()
  await expect(page.getByText('signup_date')).toBeVisible()
  await expect(page.getByText('email', { exact: true })).toBeVisible()
})
