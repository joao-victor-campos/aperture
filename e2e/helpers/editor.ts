import { expect, type Page } from '@playwright/test'
import { PG_CONNECTION_NAME } from './postgres'

/**
 * Point the focused tab's connection picker at a connection by name.
 * The auto-opened boot tab may not be bound to any connection (store load is async),
 * so specs bind explicitly — deterministic regardless of boot timing.
 */
export async function bindTabToConnection(page: Page, name = PG_CONNECTION_NAME): Promise<void> {
  const picker = page.locator('select[title="Connection for this tab"]')
  await expect(picker).toBeVisible({ timeout: 15_000 })
  await picker.selectOption({ label: name })
}

/** Type SQL into the focused CodeMirror editor (the boot tab starts empty). */
export async function typeSql(page: Page, sql: string): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.type(sql)
  // Dismiss any autocomplete popup the typing triggered
  await page.keyboard.press('Escape')
}
