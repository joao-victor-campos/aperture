import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'

interface QueryEditorProps {
  value: string
  onChange: (value: string) => void
  onRun: () => void
  onCancel: () => void
  isRunning: boolean
}

const customTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace"
  },
  '.cm-content': { padding: '12px 0' },
  '.cm-focused': { outline: 'none' },
  '.cm-gutters': { backgroundColor: '#111827', borderRight: '1px solid #1f2937' },
  '.cm-lineNumbers .cm-gutterElement': { color: '#374151' }
})

export default function QueryEditor({
  value,
  onChange,
  onRun,
  onCancel,
  isRunning
}: QueryEditorProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800 bg-gray-950 shrink-0">
        <span className="text-[10px] uppercase tracking-widest text-gray-600 font-medium">SQL</span>

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
            className="flex items-center gap-1.5 text-xs px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors font-medium"
          >
            <span>▶ Run</span>
            <kbd className="text-indigo-300 text-[10px] font-mono">⌘↵</kbd>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-hidden selectable">
        <CodeMirror
          value={value}
          height="100%"
          theme={oneDark}
          extensions={[sql(), customTheme]}
          onChange={onChange}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              if (isRunning) onCancel()
              else onRun()
            }
          }}
          style={{ height: '100%' }}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: true,
            autocompletion: true,
            bracketMatching: true,
            closeBrackets: true
          }}
        />
      </div>
    </div>
  )
}
