import { useState } from 'react'
import { Search, Table2, FileText, Play, Database, ListTree, Copy, Check } from 'lucide-react'
import type { ChatMessage, ChatContentBlock, ChatTextBlock } from '@shared/types'

const TOOL_ICON: Record<string, typeof Search> = {
  search_tables: Search,
  get_table_schema: Table2,
  list_datasets: Database,
  open_query_tab: FileText,
  dry_run_query: ListTree,
  run_query: Play,
}

function ToolChip({ name }: { name: string }) {
  const Icon = TOOL_ICON[name] ?? ListTree
  return (
    <div className="inline-flex items-center gap-1 text-ui-xs text-app-text-3 bg-app-elevated rounded px-1.5 py-0.5">
      <Icon size={11} /> {name.replace(/_/g, ' ')}
    </div>
  )
}

/** Render the visible parts of a message. tool_result blocks (role 'user') are hidden. */
export default function MessageBubble({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false)

  if (message.content.every((b) => b.type === 'tool_result')) return null

  const isUser = message.role === 'user'
  const text = message.content
    .filter((b): b is ChatTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n')
    .trim()

  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`group flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`relative max-w-[88%] rounded-lg px-3 py-2 text-ui select-text ${
          isUser ? 'bg-app-accent-subtle text-app-text' : 'bg-app-elevated text-app-text'
        }`}
      >
        {message.content.map((block: ChatContentBlock, i) => {
          if (block.type === 'text') {
            return block.text ? <p key={i} className="whitespace-pre-wrap">{block.text}</p> : null
          }
          if (block.type === 'tool_use') {
            return <div key={i} className="mt-1"><ToolChip name={block.name} /></div>
          }
          return null
        })}

        {text && (
          <button
            type="button"
            onClick={copy}
            aria-label="Copy message"
            title="Copy"
            className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded bg-app-surface border border-app-border text-app-text-3 hover:text-app-text transition-all"
          >
            {copied ? <Check size={11} className="text-app-ok" /> : <Copy size={11} />}
          </button>
        )}
      </div>
    </div>
  )
}
