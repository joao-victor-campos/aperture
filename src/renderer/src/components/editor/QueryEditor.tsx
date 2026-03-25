import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView, keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { Bookmark, BookmarkCheck } from 'lucide-react'

interface QueryEditorProps {
  value: string
  onChange: (value: string) => void
  onRun: () => void
  onCancel: () => void
  onSave: () => void
  isRunning: boolean
  savedQueryId?: string
  sqlSchema?: Record<string, string[]>
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

export default function QueryEditor({
  value, onChange, onRun, onCancel, onSave, isRunning, savedQueryId, sqlSchema,
}: QueryEditorProps) {
  const sqlExtension = useMemo(
    () => sql({ schema: sqlSchema ?? {} }),
    [sqlSchema]
  )

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
        run: () => { onSave(); return true },
      },
    ])),
    [isRunning, onCancel, onRun, onSave]
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-app-border bg-app-surface shrink-0">
        <span className="text-[10px] uppercase tracking-widest text-app-text-3 font-medium">SQL</span>

        <div className="flex items-center gap-2">
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
