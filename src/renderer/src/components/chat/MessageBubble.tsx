import { useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Search, Table2, FileText, Play, Database, ListTree, Copy, Check } from 'lucide-react'
import type { ChatMessage, ChatContentBlock, ChatTextBlock } from '@shared/types'

const TOOL_ICON: Record<string, typeof Search> = {
  search_tables: Search,
  list_tables: Table2,
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

// Tailwind-styled element overrides so Markdown matches the app's design tokens.
const MD_COMPONENTS: Components = {
  p: ({ children }) => <p className="whitespace-pre-wrap leading-relaxed [&:not(:first-child)]:mt-2">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-app-text">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-app-accent-text underline hover:no-underline">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="list-disc pl-5 my-2 flex flex-col gap-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-2 flex flex-col gap-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h1 className="text-ui-md font-semibold mt-3 mb-1">{children}</h1>,
  h2: ({ children }) => <h2 className="text-ui-md font-semibold mt-3 mb-1">{children}</h2>,
  h3: ({ children }) => <h3 className="text-ui font-semibold mt-2 mb-1">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-app-border pl-3 text-app-text-2 my-2">{children}</blockquote>
  ),
  hr: () => <hr className="border-app-border my-3" />,
  code: ({ className, children }) => {
    const isBlock = (className ?? '').includes('language-')
    if (isBlock) {
      return <code className="font-tabular text-ui-xs">{children}</code>
    }
    return <code className="font-tabular text-ui-xs bg-app-surface border border-app-border rounded px-1 py-0.5">{children}</code>
  },
  pre: ({ children }) => (
    <pre className="bg-app-surface border border-app-border rounded-md p-2 my-2 overflow-x-auto text-ui-xs">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full text-ui-xs border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-app-border">{children}</thead>,
  th: ({ children }) => <th className="text-left font-semibold px-2 py-1 align-top">{children}</th>,
  td: ({ children }) => <td className="px-2 py-1 align-top border-t border-app-border/50">{children}</td>,
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="text-ui">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {text}
      </ReactMarkdown>
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
            // User messages are plain text; assistant text is Markdown.
            if (!block.text) return null
            return isUser ? (
              <p key={i} className="whitespace-pre-wrap">{block.text}</p>
            ) : (
              <Markdown key={i} text={block.text} />
            )
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
