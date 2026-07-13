import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchApp, captureOnFailure } from '../helpers/app'
import { addPostgresConnection } from '../helpers/connectionModal'
import { PG_CONNECTION_NAME } from '../helpers/postgres'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async ({}, testInfo) => {
  await captureOnFailure(page, testInfo)
  await app?.close()
})

test('adds a Postgres connection through the modal and shows a healthy status', async () => {
  await addPostgresConnection(page)
  // Breadcrumb shows engine / name (scoped to the breadcrumb button — the auto-opened
  // query tab's per-tab connection picker also renders the name as an <option>)
  await expect(page.getByText('postgres', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: `postgres / ${PG_CONNECTION_NAME}` }),
  ).toBeVisible()
  // Health dot is green — "Test & Save" ran a real connectivity check
  await expect(page.locator('.app-dot--ok').first()).toBeVisible()
})
