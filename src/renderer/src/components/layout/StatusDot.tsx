import type { ConnectionStatus } from '../../store/connectionStore'

export default function StatusDot({ status }: { status: ConnectionStatus }) {
  // Design-system primitives (.app-dot with halo glow); fallback grey for unknown
  if (status === 'ok') return <span className="app-dot app-dot--ok shrink-0" />
  if (status === 'error') return <span className="app-dot app-dot--err shrink-0" />
  return <span className="app-dot shrink-0" style={{ backgroundColor: 'rgb(var(--c-text-3))' }} />
}
