import { useEffect, useRef } from 'react'

interface QueryLogViewProps {
  logs: string[]
  /** Running state brightens the most recent line; terminal states don't. */
  highlightLast?: boolean
}

export default function QueryLogView({ logs, highlightLast = false }: QueryLogViewProps) {
  const logEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="space-y-1">
      {logs.map((line, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 ${
            highlightLast && i === logs.length - 1 ? 'text-app-text' : 'text-app-text-3'
          }`}
        >
          <span className="shrink-0 mt-px text-app-text-3/50">›</span>
          <span>{line}</span>
        </div>
      ))}
      <div ref={logEndRef} />
    </div>
  )
}
