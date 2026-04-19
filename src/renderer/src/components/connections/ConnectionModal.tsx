import { useState } from 'react'
import { X, CheckCircle, XCircle } from 'lucide-react'
import { useConnectionStore } from '../../store/connectionStore'
import type {
  BigQueryConnection,
  Connection,
  ConnectionCreate,
  PostgresConnection,
  SnowflakeConnection,
} from '@shared/types'

type Engine = 'bigquery' | 'snowflake' | 'postgres'

interface ConnectionModalProps {
  onClose: () => void
  /** When provided the modal opens in edit mode, pre-filled with the connection's values. */
  initialConnection?: Connection
}

const ENGINES: { id: Engine; label: string }[] = [
  { id: 'bigquery', label: 'BigQuery' },
  { id: 'snowflake', label: 'Snowflake' },
  { id: 'postgres', label: 'Postgres' },
]

export default function ConnectionModal({ onClose, initialConnection }: ConnectionModalProps) {
  const { add, update, test } = useConnectionStore()
  const isEdit = Boolean(initialConnection)
  const initEngine = ((initialConnection?.engine ?? 'bigquery') as Engine)

  const [engine, setEngine] = useState<Engine>(initEngine)

  // ── Shared ──────────────────────────────────────────────────────────────
  const [name, setName] = useState(initialConnection?.name ?? '')

  // ── BigQuery ─────────────────────────────────────────────────────────────
  const bqInit = initEngine === 'bigquery' ? (initialConnection as BigQueryConnection) : undefined
  const [projectId, setProjectId] = useState(bqInit?.projectId ?? '')
  const [credentialType, setCredentialType] = useState<BigQueryConnection['credentialType']>(
    bqInit?.credentialType ?? 'adc'
  )
  const [serviceAccountPath, setServiceAccountPath] = useState(bqInit?.serviceAccountPath ?? '')

  // ── Postgres ──────────────────────────────────────────────────────────────
  const pgInit = initEngine === 'postgres' ? (initialConnection as PostgresConnection) : undefined
  const [host, setHost] = useState(pgInit?.host ?? '')
  const [port, setPort] = useState(String(pgInit?.port ?? 5432))
  const [pgDatabase, setPgDatabase] = useState(pgInit?.database ?? '')
  const [pgUser, setPgUser] = useState(pgInit?.user ?? '')
  const [pgPassword, setPgPassword] = useState(pgInit?.password ?? '')

  // ── Snowflake ─────────────────────────────────────────────────────────────
  const sfInit = initEngine === 'snowflake' ? (initialConnection as SnowflakeConnection) : undefined
  const [sfAccount, setSfAccount] = useState(sfInit?.account ?? '')
  const [sfUsername, setSfUsername] = useState(sfInit?.username ?? '')
  const [sfPassword, setSfPassword] = useState(sfInit?.password ?? '')
  const [sfWarehouse, setSfWarehouse] = useState(sfInit?.warehouse ?? '')
  const [sfDatabase, setSfDatabase] = useState(sfInit?.database ?? '')
  const [sfSchema, setSfSchema] = useState(sfInit?.schema ?? '')
  const [sfRole, setSfRole] = useState(sfInit?.role ?? '')

  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)

  // ── Validation ────────────────────────────────────────────────────────────
  const isValid =
    Boolean(name.trim()) &&
    (() => {
      if (engine === 'bigquery') return Boolean(projectId.trim())
      if (engine === 'postgres')
        return Boolean(
          host.trim() &&
            pgDatabase.trim() &&
            pgUser.trim() &&
            pgPassword.trim() &&
            Number.isFinite(Number(port)) &&
            Number(port) > 0
        )
      // snowflake
      return Boolean(sfAccount.trim() && sfUsername.trim() && sfPassword.trim() && sfWarehouse.trim())
    })()

  const buildPayload = (): ConnectionCreate => {
    if (engine === 'bigquery') {
      return {
        engine: 'bigquery',
        name: name.trim(),
        projectId: projectId.trim(),
        credentialType,
        serviceAccountPath:
          credentialType === 'service-account' ? serviceAccountPath.trim() : undefined,
      }
    }
    if (engine === 'postgres') {
      return {
        engine: 'postgres',
        name: name.trim(),
        host: host.trim(),
        port: Number(port),
        database: pgDatabase.trim(),
        user: pgUser.trim(),
        password: pgPassword,
      }
    }
    return {
      engine: 'snowflake',
      name: name.trim(),
      account: sfAccount.trim(),
      username: sfUsername.trim(),
      password: sfPassword.trim(),
      warehouse: sfWarehouse.trim(),
      database: sfDatabase.trim() || undefined,
      schema: sfSchema.trim() || undefined,
      role: sfRole.trim() || undefined,
    }
  }

  const handleSave = async () => {
    if (!isValid) return
    setIsSaving(true)
    if (isEdit && initialConnection) {
      await update({ ...initialConnection, ...buildPayload() } as Connection)
    } else {
      await add(buildPayload())
    }
    setIsSaving(false)
    onClose()
  }

  const handleTest = async () => {
    if (!isValid) return
    setIsTesting(true)
    setTestResult(null)
    let connId: string
    if (isEdit && initialConnection) {
      await update({ ...initialConnection, ...buildPayload() } as Connection)
      connId = initialConnection.id
    } else {
      const newConn = await add(buildPayload())
      connId = newConn.id
    }
    const result = await test(connId)
    setTestResult(result)
    setIsTesting(false)
    if (result.ok) onClose()
  }

  const switchEngine = (id: Engine) => {
    if (isEdit) return
    setEngine(id)
    setTestResult(null)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-app-surface rounded-xl shadow-2xl w-[520px] border border-app-border">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-app-border">
          <h2 className="text-sm font-semibold text-app-text">
            {isEdit ? 'Edit Connection' : 'New Connection'}
          </h2>
          <button
            onClick={onClose}
            className="text-app-text-2 hover:text-app-text transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Engine tabs */}
        <div className="flex border-b border-app-border">
          {ENGINES.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => switchEngine(id)}
              disabled={isEdit && id !== engine}
              className={`px-4 py-2 text-xs transition-colors ${
                engine === id
                  ? 'text-app-accent-text border-b-2 border-app-accent'
                  : isEdit
                  ? 'hidden'
                  : 'text-app-text-2 hover:text-app-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Form body */}
        <div className="p-5 flex flex-col gap-4">
          <Field label="Connection name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Connection"
              autoFocus
              className={inputCls}
            />
          </Field>

          {/* BigQuery fields */}
          {engine === 'bigquery' && (
            <>
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
            </>
          )}

          {/* Postgres fields */}
          {engine === 'postgres' && (
            <>
              <Field label="Host">
                <input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="localhost"
                  className={inputCls}
                />
              </Field>
              <div className="flex gap-4">
                <Field label="Port">
                  <input
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    placeholder="5432"
                    className={inputCls}
                  />
                </Field>
                <Field label="Database">
                  <input
                    value={pgDatabase}
                    onChange={(e) => setPgDatabase(e.target.value)}
                    placeholder="my_database"
                    className={inputCls}
                  />
                </Field>
              </div>
              <div className="flex gap-4">
                <Field label="User">
                  <input
                    value={pgUser}
                    onChange={(e) => setPgUser(e.target.value)}
                    placeholder="my_user"
                    className={inputCls}
                  />
                </Field>
                <Field label="Password">
                  <input
                    type="password"
                    value={pgPassword}
                    onChange={(e) => setPgPassword(e.target.value)}
                    placeholder="••••••••"
                    className={inputCls}
                  />
                </Field>
              </div>
            </>
          )}

          {/* Snowflake fields */}
          {engine === 'snowflake' && (
            <>
              <Field label="Account identifier">
                <input
                  value={sfAccount}
                  onChange={(e) => setSfAccount(e.target.value)}
                  placeholder="xy12345.us-east-1  or  orgname-accountname"
                  className={inputCls}
                />
              </Field>
              <div className="flex gap-4">
                <Field label="Username">
                  <input
                    value={sfUsername}
                    onChange={(e) => setSfUsername(e.target.value)}
                    placeholder="MY_USER"
                    className={inputCls}
                  />
                </Field>
                <Field label="Password">
                  <input
                    type="password"
                    value={sfPassword}
                    onChange={(e) => setSfPassword(e.target.value)}
                    placeholder="••••••••"
                    className={inputCls}
                  />
                </Field>
              </div>
              <Field label="Warehouse">
                <input
                  value={sfWarehouse}
                  onChange={(e) => setSfWarehouse(e.target.value)}
                  placeholder="COMPUTE_WH"
                  className={inputCls}
                />
              </Field>
              <div className="flex gap-4">
                <Field label="Database (optional)">
                  <input
                    value={sfDatabase}
                    onChange={(e) => setSfDatabase(e.target.value)}
                    placeholder="MY_DB"
                    className={inputCls}
                  />
                </Field>
                <Field label="Schema (optional)">
                  <input
                    value={sfSchema}
                    onChange={(e) => setSfSchema(e.target.value)}
                    placeholder="PUBLIC"
                    className={inputCls}
                  />
                </Field>
                <Field label="Role (optional)">
                  <input
                    value={sfRole}
                    onChange={(e) => setSfRole(e.target.value)}
                    placeholder="SYSADMIN"
                    className={inputCls}
                  />
                </Field>
              </div>
            </>
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

        {/* Footer */}
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
  label,
  description,
  active,
  onClick,
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
