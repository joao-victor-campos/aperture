import { Sparkles, X } from 'lucide-react'
import { useChatStore } from '../../store/chatStore'
import { useConnectionStore } from '../../store/connectionStore'
import MessageList from './MessageList'
import ChatComposer from './ChatComposer'
import ThreadRail from './ThreadRail'

interface Props {
  onClose: () => void
}

export default function ChatPanel({ onClose }: Props) {
  const threads = useChatStore((s) => s.threads)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)

  // The active thread is created lazily on first send (see chatStore.sendMessage),
  // so we don't auto-create empty threads here.
  const activeThread = threads.find((t) => t.id === activeThreadId)

  return (
    <div className="w-[420px] border-l border-app-border flex flex-col bg-app-surface shrink-0">
      <div className="flex items-center justify-between px-3 h-[40px] border-b border-app-border">
        <div className="flex items-center gap-1.5 text-ui font-semibold text-app-accent-text">
          <Sparkles size={14} /> Assistant
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close assistant"
          className="p-1 rounded text-app-text-3 hover:text-app-text hover:bg-app-elevated"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0">
          {activeConnectionId ? (
            <>
              <MessageList messages={activeThread?.messages ?? []} />
              <ChatComposer disabled={isStreaming} onSend={sendMessage} />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-ui text-app-text-3 px-4 text-center">
              Connect to a database to start chatting.
            </div>
          )}
        </div>
        <ThreadRail />
      </div>
    </div>
  )
}
