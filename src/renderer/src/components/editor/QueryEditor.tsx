import { memo, useCallback, useMemo, useRef } from 'react'
import { format as formatSQL } from 'sql-formatter'
import CodeMirror from '@uiw/react-codemirror'
import { autocompletion } from '@codemirror/autocomplete'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView, keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { Bookmark, BookmarkCheck, Columns2, ListTree, Sparkles, WandSparkles } from 'lucide-react'
import type { ConnectionEngine } from '@shared/types'
import { CHANNELS } from '@shared/ipc'
import { cypher, type CypherSchema } from '../../lib/cypherLanguage'
import { sqlSupport } from '../../lib/sqlCompletion'
import { inlineCompletion } from '../../lib/inlineCompletion'
import { useAiSettingsStore } from '../../store/aiSettingsStore'

interface QueryEditorProps {
  value: string
  onChange: (value: string) => void
  onRun: () => void
  onCancel: () => void
  onExplain?: () => void
  onSave?: () => void
  onSplit?: () => void
  isSplit?: boolean
  isRunning: boolean
  isExplaining?: boolean
  savedQueryId?: string
  sqlSchema?: Record<string, string[]>
  cypherSchema?: CypherSchema
  engine?: ConnectionEngine
}

// sql-formatter dialect names (for formatting)
const FORMAT_DIALECT_MAP: Record<ConnectionEngine, string> = {
  bigquery: 'bigquery',
  postgres: 'postgresql',
  snowflake: 'snowflake',
  neo4j: 'sql', // unused — Cypher formatting is skipped (sql-formatter has no Cypher dialect)
}

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

function QueryEditor({
  value, onChange, onRun, onCancel, onExplain, onSave, onSplit, isSplit, isRunning, isExplaining, savedQueryId, sqlSchema, cypherSchema, engine,
}: QueryEditorProps) {
  const languageExtension = useMemo(() => {
    if (engine === 'neo4j') return cypher(cypherSchema)
    return sqlSupport(engine, sqlSchema)
  }, [sqlSchema, cypherSchema, engine])

  const inlineEnabled = useAiSettingsStore((s) => s.enabled && s.keyConfigured)
  const keyConfigured = useAiSettingsStore((s) => s.keyConfigured)
  const setInlineEnabled = useAiSettingsStore((s) => s.setEnabled)

  // Live refs so the (stable) inline extension reads current values without rebuilding.
  const enabledRef = useRef(inlineEnabled)
  enabledRef.current = inlineEnabled
  const engineRef = useRef(engine)
  engineRef.current = engine
  const schemaRef = useRef(sqlSchema)
  schemaRef.current = sqlSchema

  const inlineExt = useMemo(
    () =>
      inlineCompletion({
        isEnabled: () => enabledRef.current,
        getEngine: () => engineRef.current,
        getSchema: () => schemaRef.current ?? {},
        request: async (r) => {
          const res = await window.api.invoke(CHANNELS.AI_COMPLETE_INLINE, r)
          return res.text
        },
      }),
    []
  )

  const handleFormat = useCallback(() => {
    if (!value.trim()) return
    if (engine === 'neo4j') return // Cypher has no sql-formatter dialect
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
        key: 'Mod-e',
        run: () => { onExplain?.(); return true },
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
    [isRunning, onCancel, onRun, onExplain, onSave, handleFormat]
  )

  const extensions = useMemo(
    () => [
      languageExtension,
      keymapExtension,
      customTheme,
      inlineExt,
      autocompletion({ activateOnTyping: true, defaultKeymap: true, icons: true }),
    ],
    [languageExtension, keymapExtension, inlineExt],
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-app-border bg-app-surface shrink-0">
        <span className="app-section-label">SQL</span>

        <div className="flex items-center gap-2">
          {/* Inline AI completions toggle */}
          <button
            onClick={() => void setInlineEnabled(!inlineEnabled)}
            disabled={!keyConfigured}
            title={
              !keyConfigured
                ? 'Add an API key in Settings → AI to enable inline completions'
                : inlineEnabled
                  ? 'Inline AI completions: on'
                  : 'Inline AI completions: off'
            }
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              inlineEnabled
                ? 'text-app-accent-text hover:bg-app-elevated'
                : 'text-app-text-2 hover:text-app-text hover:bg-app-elevated'
            }`}
          >
            <Sparkles size={13} />
            <span className="text-[11px]">AI</span>
          </button>

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

          {/* Explain button */}
          {onExplain && (
            <button
              onClick={onExplain}
              disabled={!value.trim() || isRunning || isExplaining}
              title="Explain plan (⌘E)"
              className="flex items-center gap-1 text-xs px-2 py-1 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ListTree size={13} />
              <span className="text-[11px]">Explain</span>
            </button>
          )}

          {/* Run / Cancel button */}
          {isRunning ? (
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 text-xs px-3 py-1 rounded bg-app-err hover:bg-app-err/90 text-white transition-colors font-medium"
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
              <kbd className="app-kbd !bg-app-accent-hover/50 !text-white !border-app-accent-hover">⌘↵</kbd>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden selectable">
        <CodeMirror
          value={value}
          height="100%"
          theme={oneDark}
          extensions={extensions}
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

export default memo(QueryEditor)
