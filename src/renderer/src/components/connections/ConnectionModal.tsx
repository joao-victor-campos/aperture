import { useState } from 'react'
import { X, CheckCircle, XCircle } from 'lucide-react'
import { useConnectionStore } from '../../store/connectionStore'
import type { Connection } from '@shared/types'

interface ConnectionModalProps {
  onClose: () => void
}

export default function ConnectionModal({ onClose }: ConnectionModalProps) {
  const { add, test } = useConnectionStore()

  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState('')
  const [credentialType, setCredentialType] = useState<Connection['credentialType']>('adc')
  const [serviceAccountPath, setServiceAccountPath] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)

  const isValid = name.trim().length > 0 && projectId.trim().length > 0

  const handleSave = async () => {
    if (!isValid) return
    setIsSaving(true)
    await add({
      name: name.trim(),
      projectId: projectId.trim(),
      credentialType,
      serviceAccountPath:
        credentialType === 'service-account' ? serviceAccountPath.trim() : undefined,
    })
    setIsSaving(false)
    onClose()
  }

  const handleTest = async () => {
    if (!isValid) return
    setIsTesting(true)
    setTestResult(null)
    const tempConn = await add({
      name: name.trim(),
      projectId: projectId.trim(),
      credentialType,
      serviceAccountPath:
        credentialType === 'service-account' ? serviceAccountPath.trim() : undefined,
    })
    const result = await test(tempConn.id)
    setTestResult(result)
    setIsTesting(false)
    if (result.ok) onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-app-surface rounded-xl shadow-2xl w-[480px] border border-app-border">
        <div className="flex items-center justify-between px-5 py-4 border-b border-app-border">
          <h2 className="text-sm font-semibold text-app-text">New BigQuery Connection</h2>
          <button onClick={onClose} className="text-app-text-2 hover:text-app-text transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <Field label="Connection name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project"
              autoFocus
              className={inputCls}
            />
          </Field>

          <Field label="GCP Project ID">
            <input
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="my-gcp-project-id"
              className={inputCls}
            />
          </Field>

          <Field label="Authentication">
            <div className="flex gap-2">
              <CredButton
                label="Application Default Credentials"
                description="Uses gcloud auth or GOOGLE_APPLICATION_CREDENTIALS env var"
                active={credentialType === 'adc'}
                onClick={() => setCredentialType('adc')}
              />
              <CredButton
                label="Service Account JSON"
                description="Provide a path to a key file"
                active={credentialType === 'service-account'}
                onClick={() => setCredentialType('service-account')}
              />
            </div>
          </Field>

          {credentialType === 'service-account' && (
            <Field label="Key file path">
              <input
                value={serviceAccountPath}
                onChange={(e) => setServiceAccountPath(e.target.value)}
                placeholder="/Users/you/keys/service-account.json"
                className={inputCls}
              />
            </Field>
          )}

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
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-lg text-app-text-2 hover:text-app-text transition-colors"
          >
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

function CredButton({
  label, description, active, onClick,
}: {
  label: string
  description: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-start gap-0.5 text-left py-2.5 px-3 rounded-lg border transition-colors ${
        active
          ? 'border-app-accent bg-app-accent-subtle text-app-accent-text'
          : 'border-app-border text-app-text-2 hover:border-app-text-3'
      }`}
    >
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[10px] text-app-text-3 leading-snug">{description}</span>
    </button>
  )
}
