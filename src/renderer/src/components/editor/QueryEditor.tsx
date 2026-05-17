import { useCallback, useMemo } from 'react'
import { format as formatSQL } from 'sql-formatter'
import CodeMirror from '@uiw/react-codemirror'
import { sql, PostgreSQL, StandardSQL } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView, keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { Bookmark, BookmarkCheck, Columns2, WandSparkles } from 'lucide-react'
import type { ConnectionEngine } from '@shared/types'

interface QueryEditorProps {
  value: string
  onChange: (value: string) => void
  onRun: () => void
  onCancel: () => void
  onSave?: () => void
  onSplit?: () => void
  isSplit?: boolean
  isRunning: boolean
  savedQueryId?: string
  sqlSchema?: Record<string, string[]>
  engine?: ConnectionEngine
}

// sql-formatter dialect names (for formatting)
const FORMAT_DIALECT_MAP: Record<ConnectionEngine, string> = {
  bigquery: 'bigquery',
  postgres: 'postgresql',
  snowflake: 'snowflake',
}

// CodeMirror SQL dialect objects (for autocomplete keyword set)
const CM_DIALECT_MAP = {
  bigquery: StandardSQL,
  postgres: PostgreSQL,
  snowflake: StandardSQL,
} satisfies Record<ConnectionEngine, typeof StandardSQL>

const customTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  },
  '.cm-content': { padding: '12px 0' },
  '.cm-focused': { outline: 'none' },
  '.cm-gutters': { backgroundColor: '#111827', borderRight: '1px solid #1f2937' },
  '.cm-lineNumbers .cm-gutterElement': { color: '#374151' },
})

export default function QueryEditor({
  value, onChange, onRun, onCancel, onSave, onSplit, isSplit, isRunning, savedQueryId, sqlSchema, engine,
}: QueryEditorProps) {
  const sqlExtension = useMemo(
    () => sql({
      dialect: engine ? CM_DIALECT_MAP[engine] : StandardSQL,
      schema: sqlSchema ?? {},
      upperCaseKeywords: true,
    }),
    [sqlSchema, engine]
  )

  const handleFormat = useCallback(() => {
    if (!value.trim()) return
    try {
      const dialect = engine ? FORMAT_DIALECT_MAP[engine] : 'sql'
      const formatted = formatSQL(value, { language: dialect as never, tabWidth: 2, keywordCase: 'upper' })
      onChange(formatted)
    } catch {
      // If formatting fails (e.g. invalid SQL), leave the value unchanged
    }
  }, [value, engine, onChange])

  // Keymap registered inside CodeMirror so Prec.highest prevents the default
  // Enter handler from also inserting a newline when ⌘↵ is pressed.
  const keymapExtension = useMemo(
    () => Prec.highest(keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          if (isRunning) onCancel(); else onRun()
          return true
        },
      },
      {
        key: 'Mod-s',
        run: () => { onSave?.(); return true },
      },
      {
        key: 'Alt-Mod-f',
        run: () => { handleFormat(); return true },
      },
    ])),
    [isRunning, onCancel, onRun, onSave, handleFormat]
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-app-border bg-app-surface shrink-0">
        <span className="text-[10px] uppercase tracking-widest text-app-text-3 font-medium">SQL</span>

        <div className="flex items-center gap-2">
          {/* Format button */}
          <button
            onClick={handleFormat}
            disabled={!value.trim() || isRunning}
            title="Format SQL (⌥⌘F)"
            className="flex items-center gap-1 text-xs px-2 py-1 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <WandSparkles size={13} />
            <span className="text-[11px]">Format</span>
          </button>

          {/* Split button */}
          {onSplit && (
            <button
              onClick={onSplit}
              title={isSplit ? 'Close split pane' : 'Split pane'}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
                isSplit
                  ? 'text-app-accent hover:text-app-accent/80 hover:bg-app-elevated'
                  : 'text-app-text-2 hover:text-app-text hover:bg-app-elevated'
              }`}
            >
              <Columns2 size={13} />
              <span className="text-[11px]">{isSplit ? 'Unsplit' : 'Split'}</span>
            </button>
          )}

          {/* Save button */}
          <button
            onClick={onSave}
            disabled={!value.trim()}
            title={savedQueryId ? 'Update saved query (⌘S)' : 'Save query (⌘S)'}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {savedQueryId
              ? <BookmarkCheck size={13} className="text-app-accent" />
              : <Bookmark size={13} />
            }
            <span className="text-[11px]">{savedQueryId ? 'Saved' : 'Save'}</span>
          </button>

          {/* Run / Cancel button */}
          {isRunning ? (
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 text-xs px-3 py-1 rounded bg-red-700 hover:bg-red-600 text-white transition-colors font-medium"
            >
              <span className="w-2 h-2 rounded-sm bg-white inline-block shrink-0" />
              Cancel
            </button>
          ) : (
            <button
              onClick={onRun}
              disabled={!value.trim()}
              className="flex items-center gap-1.5 text-xs px-3 py-1 rounded bg-app-accent hover:bg-app-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors font-medium"
            >
              <span>▶ Run</span>
              <kbd className="text-orange-200 text-[10px] font-mono">⌘↵</kbd>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden selectable">
        <CodeMirror
          value={value}
          height="100%"
          theme={oneDark}
          extensions={[sqlExtension, keymapExtension, customTheme]}
          onChange={onChange}
          style={{ height: '100%' }}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: true,
            autocompletion: true,
            bracketMatching: true,
            closeBrackets: true,
          }}
        />
      </div>
    </div>
  )
}
