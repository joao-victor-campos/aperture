import { expect, type Page } from '@playwright/test'
import { PG, PG_CONNECTION_NAME } from './postgres'

/**
 * Drive the New Connection modal to add the E2E Postgres via "Test & Save".
 * On success the modal closes itself and the connection appears in the title bar.
 */
export async function addPostgresConnection(page: Page, name = PG_CONNECTION_NAME): Promise<void> {
  // "+" button in the title bar (ConnectionMenu)
  await page.getByTitle('Add connection').click()
  // Engine pill
  await page.getByRole('button', { name: 'Postgres', exact: true }).click()
  // Fields (selected by their placeholders — unique among the visible engine's fields)
  await page.getByPlaceholder('My Connection').fill(name)
  await page.getByPlaceholder('localhost').fill(PG.host)
  await page.getByPlaceholder('5432').fill(String(PG.port))
  await page.getByPlaceholder('my_database').fill(PG.database)
  await page.getByPlaceholder('my_user').fill(PG.user)
  await page.getByPlaceholder('••••••••').fill(PG.password)
  // Test & Save exercises a real connection round-trip and closes the modal on success
  await page.getByRole('button', { name: 'Test & Save' }).click()
  await expect(page.getByText('New Connection')).toBeHidden()
}
