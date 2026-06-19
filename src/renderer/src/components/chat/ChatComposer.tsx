import { useState } from 'react'
import { SendHorizontal } from 'lucide-react'

interface Props {
  disabled?: boolean
  onSend: (text: string) => void
}

export default function ChatComposer({ disabled, onSend }: Props) {
  const [text, setText] = useState('')

  const submit = () => {
    const t = text.trim()
    if (!t || disabled) return
    onSend(t)
    setText('')
  }

  return (
    <div className="border-t border-app-border p-2 flex items-end gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
        }}
        rows={2}
        placeholder="Ask about your data…"
        className="flex-1 resize-none bg-app-surface border border-app-border rounded-md px-2 py-1.5 text-ui text-app-text focus:outline-none focus:ring-2 focus:ring-app-accent/30"
      />
      <button
        type="button"
        onClick={submit}
        disabled={disabled || !text.trim()}
        aria-label="Send message"
        className="p-2 rounded-md bg-app-accent hover:bg-app-accent-hover disabled:opacity-40 text-white"
      >
        <SendHorizontal size={14} />
      </button>
    </div>
  )
}
