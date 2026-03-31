import { useState } from 'react'
import { X, CheckCircle, XCircle } from 'lucide-react'
import { useConnectionStore } from '../../store/connectionStore'

interface PostgresConnectionModalProps {
  onClose: () => void
}

export default function PostgresConnectionModal({ onClose }: PostgresConnectionModalProps) {
  const { add, test } = useConnectionStore()

  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('5432')
  const [database, setDatabase] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')

  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)

  const isValid =
    name.trim().length > 0 &&
    host.trim().length > 0 &&
    database.trim().length > 0 &&
    user.trim().length > 0 &&
    password.trim().length > 0 &&
    Number.isFinite(Number(port)) &&
    Number(port) > 0

  const handleSave = async () => {
    if (!isValid) return
    setIsSaving(true)
    await add({
      engine: 'postgres',
      name: name.trim(),
      host: host.trim(),
      port: Number(port),
      database: database.trim(),
      user: user.trim(),
      password: password,
    })
    setIsSaving(false)
    onClose()
  }

  const handleTest = async () => {
    if (!isValid) return
    setIsTesting(true)
    setTestResult(null)
    const tempConn = await add({
      engine: 'postgres',
      name: name.trim(),
      host: host.trim(),
      port: Number(port),
      database: database.trim(),
      user: user.trim(),
      password: password,
    })
    const result = await test(tempConn.id)
    setTestResult(result)
    setIsTesting(false)
    if (result.ok) onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-app-surface rounded-xl shadow-2xl w-[520px] border border-app-border">
        <div className="flex items-center justify-between px-5 py-4 border-b border-app-border">
          <h2 className="text-sm font-semibold text-app-text">New Postgres Connection</h2>
          <button onClick={onClose} className="text-app-text-2 hover:text-app-text transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <Field label="Connection name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Connection" autoFocus className={inputCls} />
          </Field>

          <Field label="Host">
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" className={inputCls} />
          </Field>

          <div className="flex gap-4">
            <Field label="Port">
              <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="5432" className={inputCls} />
            </Field>

            <Field label="Database">
              <input
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                placeholder="my_database"
                className={inputCls}
              />
            </Field>
          </div>

          <div className="flex gap-4">
            <Field label="User">
              <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="my_user" className={inputCls} />
            </Field>

            <Field label="Password">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="••••••••"
                className={inputCls}
              />
            </Field>
          </div>

          {testResult && (
            <div
              className={`flex items-start gap-2 text-xs px-3 py-2.5 rounded-lg border ${
                testResult.ok
                  ? 'bg-emerald-950/50 text-emerald-400 border-emerald-900/60'
                  : 'bg-red-950/50 text-red-400 border-red-900/60'
              }`}
            >
              {testResult.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
              <span>{testResult.ok ? 'Connection successful!' : testResult.error}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-app-border">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg text-app-text-2 hover:text-app-text transition-colors">
            Cancel
          </button>

          <button
            onClick={handleTest}
            disabled={!isValid || isTesting || isSaving}
            className="text-xs px-3 py-1.5 rounded-lg bg-app-elevated hover:bg-app-border disabled:opacity-40 disabled:cursor-not-allowed text-app-text transition-colors"
          >
            {isTesting ? 'Testing…' : 'Test & Save'}
          </button>

          <button
            onClick={handleSave}
            disabled={!isValid || isSaving || isTesting}
            className="text-xs px-3 py-1.5 rounded-lg bg-app-accent hover:bg-app-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors font-medium"
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputCls =
  'w-full bg-app-elevated border border-app-border rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:border-app-accent placeholder-app-text-3 transition-colors'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-app-text-2 font-medium">{label}</label>
      {children}
    </div>
  )
}

