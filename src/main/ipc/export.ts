import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import { CHANNELS } from '../../shared/ipc'

export function registerExportHandlers(): void {
  ipcMain.handle(CHANNELS.EXPORT_RESULTS, async (event, req: {
    rows: Record<string, unknown>[]
    columns: string[]
    format: 'csv' | 'json' | 'tsv'
  }) => {
    console.log('[Export] handler called, format:', req?.format, 'rows:', req?.rows?.length)
    const { rows, columns, format } = req
    const ext = format
    // Attach the dialog to the BrowserWindow so it appears as a sheet on macOS
    const win = BrowserWindow.fromWebContents(event.sender)
    console.log('[Export] BrowserWindow found:', !!win)
    const dialogOptions = {
      defaultPath: `results.${ext}`,
      filters: [{ name: format.toUpperCase(), extensions: [ext] }],
    }
    try {
      const result = await (win
        ? dialog.showSaveDialog(win, dialogOptions)
        : dialog.showSaveDialog(dialogOptions))
      console.log('[Export] dialog result:', result)
      if (result.canceled || !result.filePath) return { path: null }

      const content = buildContent(rows, columns, format)
      writeFileSync(result.filePath, content, 'utf-8')
      return { path: result.filePath }
    } catch (err) {
      console.error('[Export] dialog error:', err)
      throw err
    }
  })
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    if ('value' in v && typeof v.value === 'string') return v.value
    return JSON.stringify(value)
  }
  return String(value)
}

function buildContent(
  rows: Record<string, unknown>[],
  columns: string[],
  format: 'csv' | 'json' | 'tsv'
): string {
  if (format === 'json') {
    return JSON.stringify(
      rows.map((row) => {
        const obj: Record<string, unknown> = {}
        for (const col of columns) obj[col] = row[col] ?? null
        return obj
      }),
      null,
      2
    )
  }

  const sep = format === 'tsv' ? '\t' : ','

  const escapeCell = (val: unknown): string => {
    const s = cellToString(val)
    if (format === 'csv' && (s.includes(',') || s.includes('"') || s.includes('\n'))) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  const header = columns.map((c) => escapeCell(c)).join(sep)
  const body = rows.map((row) => columns.map((col) => escapeCell(row[col])).join(sep)).join('\n')
  return header + '\n' + body
}
