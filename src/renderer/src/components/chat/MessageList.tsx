import { useEffect, useRef } from 'react'
import type { ChatMessage } from '@shared/types'
import MessageBubble from './MessageBubble'
import RunConfirmCard from './RunConfirmCard'
import { useChatStore } from '../../store/chatStore'

interface Props {
  messages: ChatMessage[]
}

export default function MessageList({ messages }: Props) {
  const streamingText = useChatStore((s) => s.streamingText)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const pendingConfirm = useChatStore((s) => s.pendingConfirm)
  const error = useChatStore((s) => s.error)
  const approveRun = useChatStore((s) => s.approveRun)
  const rejectRun = useChatStore((s) => s.rejectRun)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingText, pendingConfirm, error])

  return (
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
      {messages.length === 0 && !isStreaming && !pendingConfirm && !error && (
        <div className="flex-1 flex items-center justify-center text-ui-xs text-app-text-3 text-center px-4">
          Ask anything about your data — I can explore the catalog, draft queries, and run them with your approval.
        </div>
      )}

      {messages.map((m, i) => <MessageBubble key={i} message={m} />)}

      {isStreaming && streamingText && (
        <div className="flex justify-start">
          <div className="max-w-[88%] rounded-lg px-3 py-2 text-ui bg-app-elevated text-app-text whitespace-pre-wrap">
            {streamingText}
          </div>
        </div>
      )}

      {pendingConfirm && (
        <RunConfirmCard
          sql={pendingConfirm.sql}
          bytesProcessed={pendingConfirm.bytesProcessed}
          onApprove={approveRun}
          onReject={rejectRun}
        />
      )}

      {error && (
        <div className="px-3 py-2 bg-app-err-subtle text-app-err rounded-md text-ui">{error}</div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
