import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchApp, captureOnFailure } from '../helpers/app'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async ({}, testInfo) => {
  await captureOnFailure(page, testInfo)
  await app?.close()
})

test('boots to an empty workspace', async () => {
  // Title-bar brand wordmark
  await expect(page.getByText('Aperture', { exact: true })).toBeVisible()
  // Sidebar segmented tabs (names include inline counts, hence regex)
  await expect(page.getByRole('button', { name: /Catalog/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Saved/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /History/ })).toBeVisible()
  // No connections yet — catalog shows its empty state
  await expect(page.getByText('No active connection.')).toBeVisible()
})
