import { useState } from 'react'
import { Plus, MessageSquare, Trash2 } from 'lucide-react'
import { useChatStore } from '../../store/chatStore'
import { useConnectionStore } from '../../store/connectionStore'

export default function ThreadRail() {
  const threads = useChatStore((s) => s.threads)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const newThread = useChatStore((s) => s.newThread)
  const selectThread = useChatStore((s) => s.selectThread)
  const deleteThread = useChatStore((s) => s.deleteThread)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  return (
    <div className="w-[120px] bg-app-sidebar border-l border-app-border flex flex-col shrink-0">
      <button
        type="button"
        onClick={() => activeConnectionId && newThread(activeConnectionId)}
        disabled={!activeConnectionId}
        className="flex items-center gap-1.5 m-2 px-2 py-1.5 rounded-md text-ui bg-app-accent hover:bg-app-accent-hover disabled:opacity-40 text-white"
      >
        <Plus size={13} /> New
      </button>
      <div className="flex-1 overflow-y-auto px-1.5 pb-2 flex flex-col gap-1">
        {threads.map((t) => (
          <div key={t.id} className="relative group">
            <button
              type="button"
              onClick={() => selectThread(t.id)}
              className={`w-full text-left px-2 py-1.5 rounded-md text-ui-xs truncate flex items-center gap-1.5 ${
                t.id === activeThreadId
                  ? 'bg-app-accent-sub-2 border-l-2 border-app-accent text-app-text'
                  : 'text-app-text-2 hover:bg-app-elevated'
              }`}
              title={t.title}
            >
              <MessageSquare size={11} className="shrink-0" />
              <span className="truncate">{t.title}</span>
            </button>
            {confirmId === t.id ? (
              <button
                type="button"
                onClick={() => { deleteThread(t.id); setConfirmId(null) }}
                className="absolute top-1 right-1 text-ui-xs px-1 rounded bg-app-err-subtle text-app-err"
              >
                Yes
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmId(t.id)}
                aria-label={`Delete ${t.title}`}
                className="absolute top-1.5 right-1 opacity-0 group-hover:opacity-100 p-0.5 rounded text-app-text-3 hover:text-app-err"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
