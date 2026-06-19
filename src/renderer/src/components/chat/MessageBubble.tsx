import { Search, Table2, FileText, Play, Database, ListTree } from 'lucide-react'
import type { ChatMessage, ChatContentBlock } from '@shared/types'

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
  if (message.content.every((b) => b.type === 'tool_result')) return null

  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] rounded-lg px-3 py-2 text-ui ${
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
      </div>
    </div>
  )
}
