import { useState } from 'react'
import { X, CheckCircle, XCircle } from 'lucide-react'
import { useConnectionStore } from '../../store/connectionStore'
import type {
  BigQueryConnection,
  Connection,
  Neo4jConnection,
  PostgresConnection,
  SnowflakeConnection,
} from '@shared/types'
import {
  isConnectionInputValid,
  buildConnectionPayload,
  type ConnectionFormFields,
} from '../../lib/connectionForm'

type Engine = 'bigquery' | 'snowflake' | 'postgres' | 'neo4j'

interface ConnectionModalProps {
  onClose: () => void
  /** When provided the modal opens in edit mode, pre-filled with the connection's values. */
  initialConnection?: Connection
}

const ENGINES: { id: Engine; label: string }[] = [
  { id: 'bigquery', label: 'BigQuery' },
  { id: 'snowflake', label: 'Snowflake' },
  { id: 'postgres', label: 'Postgres' },
  { id: 'neo4j', label: 'Neo4j' },
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

  // ── Neo4j ───────────────────────────────────────────────────────────────────
  const neoInit = initEngine === 'neo4j' ? (initialConnection as Neo4jConnection) : undefined
  const [neoUri, setNeoUri] = useState(neoInit?.uri ?? '')
  const [neoUsername, setNeoUsername] = useState(neoInit?.username ?? '')
  const [neoPassword, setNeoPassword] = useState(neoInit?.password ?? '')
  const [neoDatabase, setNeoDatabase] = useState(neoInit?.database ?? '')

  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)

  // ── Validation & payload (pure — see lib/connectionForm.ts) ───────────────
  const fields: ConnectionFormFields = {
    engine,
    name,
    projectId,
    credentialType,
    serviceAccountPath,
    host,
    port,
    pgDatabase,
    pgUser,
    pgPassword,
    sfAccount,
    sfUsername,
    sfPassword,
    sfWarehouse,
    sfDatabase,
    sfSchema,
    sfRole,
    neoUri,
    neoUsername,
    neoPassword,
    neoDatabase,
  }
  const isValid = isConnectionInputValid(fields)

  const handleSave = async () => {
    if (!isValid) return
    setIsSaving(true)
    if (isEdit && initialConnection) {
      await update({ ...initialConnection, ...buildConnectionPayload(fields) } as Connection)
    } else {
      await add(buildConnectionPayload(fields))
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
      await update({ ...initialConnection, ...buildConnectionPayload(fields) } as Connection)
      connId = initialConnection.id
    } else {
      const newConn = await add(buildConnectionPayload(fields))
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
      <div className="bg-app-surface rounded-xl shadow-app-card w-[520px] border border-app-border animate-modal-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-app-border">
          <div className="flex flex-col gap-0.5">
            <span className="app-section-label">{isEdit ? 'Edit' : 'New'} Connection</span>
            <h2 className="text-app-text font-semibold text-[15px]">
              {isEdit ? initialConnection?.name : ENGINES.find((e) => e.id === engine)?.label}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-app-text-3 hover:text-app-text hover:bg-app-elevated rounded-md p-1 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Engine selector — segmented pill (hidden in edit mode) */}
        {!isEdit && (
          <div className="px-5 pt-4">
            <div className="app-segmented">
              {ENGINES.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => switchEngine(id)}
                  data-active={engine === id || undefined}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

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

          {/* Neo4j fields */}
          {engine === 'neo4j' && (
            <>
              <Field label="Connection URI">
                <input
                  value={neoUri}
                  onChange={(e) => setNeoUri(e.target.value)}
                  placeholder="neo4j://localhost:7687"
                  className={inputCls}
                />
              </Field>
              <div className="flex gap-4">
                <Field label="Username">
                  <input
                    value={neoUsername}
                    onChange={(e) => setNeoUsername(e.target.value)}
                    placeholder="neo4j"
                    className={inputCls}
                  />
                </Field>
                <Field label="Password">
                  <input
                    type="password"
                    value={neoPassword}
                    onChange={(e) => setNeoPassword(e.target.value)}
                    placeholder="••••••••"
                    className={inputCls}
                  />
                </Field>
              </div>
              <Field label="Database (optional)">
                <input
                  value={neoDatabase}
                  onChange={(e) => setNeoDatabase(e.target.value)}
                  placeholder="neo4j"
                  className={inputCls}
                />
              </Field>
            </>
          )}

          {testResult && (
            <div
              className={`flex items-start gap-2 text-xs px-3 py-2.5 rounded-lg border ${
                testResult.ok
                  ? 'bg-app-ok-subtle text-app-ok border-app-ok/30'
                  : 'bg-app-err-subtle text-app-err border-app-err/30'
              }`}
            >
              {testResult.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
              <span>{testResult.ok ? 'Connection successful!' : testResult.error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-app-border bg-app-bg/40 rounded-b-xl">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-lg text-app-text-2 hover:text-app-text hover:bg-app-elevated transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleTest}
            disabled={!isValid || isTesting || isSaving}
            className="text-xs px-3 py-1.5 rounded-lg bg-app-elevated border border-app-border hover:bg-app-border/40 disabled:opacity-40 disabled:cursor-not-allowed text-app-text transition-colors"
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
  'w-full bg-app-bg border border-app-border rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent/30 placeholder-app-text-4 transition-colors'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="app-section-label">{label}</label>
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
          : 'border-app-border text-app-text-2 hover:border-app-border-2 hover:bg-app-elevated/40'
      }`}
    >
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[10px] text-app-text-3 leading-snug">{description}</span>
    </button>
  )
}
