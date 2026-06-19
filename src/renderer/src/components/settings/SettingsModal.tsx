import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Trash2, Palette, Download, RefreshCw, Check, Sparkles } from 'lucide-react'
import { CHANNELS } from '@shared/ipc'
import { useThemeStore } from '../../store/themeStore'
import { useUpdateStore } from '../../store/updateStore'
import { useAiSettingsStore } from '../../store/aiSettingsStore'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

type Section = 'themes' | 'updates' | 'ai'

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { themes, activeThemeId, importFromFile, remove, setActive } = useThemeStore()
  const updateAvailable = useUpdateStore((s) => s.status?.updateAvailable ?? false)
  const [section, setSection] = useState<Section>('themes')
  const [importError, setImportError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Clean up confirm timeout on unmount
  useEffect(() => () => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
  }, [])

  // Reset transient state when the modal closes (component stays mounted).
  useEffect(() => {
    if (!open) {
      setImportError(null)
      setConfirmDeleteId(null)
      setSection('themes')
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current)
        confirmTimeoutRef.current = null
      }
    }
  }, [open])

  if (!open) return null

  const handleImport = async () => {
    setIsImporting(true)
    setImportError(null)
    const result = await importFromFile()
    setIsImporting(false)
    if (result && 'error' in result) {
      setImportError(result.error)
    }
  }

  const requestDelete = (id: string) => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    setConfirmDeleteId(id)
    confirmTimeoutRef.current = setTimeout(() => setConfirmDeleteId(null), 3000)
  }

  const confirmDelete = async (id: string) => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    setConfirmDeleteId(null)
    await remove(id)
  }

  const navItemClass = (active: boolean) =>
    `w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-ui ${
      active
        ? 'bg-app-elevated text-app-accent-text font-semibold'
        : 'text-app-text-2 hover:text-app-text hover:bg-app-elevated'
    }`

  return createPortal(
    <div
      className="fixed inset-0 bg-black/40 z-[9999] flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`settings-modal-title-${section}`}
        className="bg-app-surface border border-app-border rounded-xl shadow-app-card w-[640px] max-h-[80vh] flex overflow-hidden"
      >
        {/* Left nav */}
        <div className="w-[140px] bg-app-sidebar border-r border-app-border p-3 shrink-0">
          <div className="app-section-label mb-3">Settings</div>
          <button onClick={() => setSection('themes')} className={navItemClass(section === 'themes')}>
            <Palette size={13} />
            Themes
          </button>
          <button onClick={() => setSection('updates')} className={`mt-1 ${navItemClass(section === 'updates')}`}>
            <Download size={13} />
            Updates
            {updateAvailable && <span className="ml-auto w-2 h-2 rounded-full bg-app-accent" />}
          </button>
          <button onClick={() => setSection('ai')} className={`mt-1 ${navItemClass(section === 'ai')}`}>
            <Sparkles size={13} />
            AI
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {section === 'themes' && (
            <>
              <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
                <div id="settings-modal-title-themes" className="text-ui-md font-semibold text-app-text">Theme Library</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleImport}
                    disabled={isImporting}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-app-accent hover:bg-app-accent-hover disabled:opacity-50 text-white rounded-md text-ui font-medium transition-colors"
                  >
                    <Plus size={12} />
                    {isImporting ? 'Importing…' : 'Import…'}
                  </button>
                  <button
                    onClick={onClose}
                    aria-label="Close settings"
                    className="p-1.5 rounded-md text-app-text-3 hover:text-app-text hover:bg-app-elevated transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {importError && (
                <div className="mx-4 mt-3 px-3 py-2 bg-app-err-subtle text-app-err rounded-md text-ui">
                  {importError}
                </div>
              )}

              <div className="p-4 overflow-y-auto grid grid-cols-3 gap-3">
                {/* Built-in dark — always first, not deletable */}
                <ThemeCard
                  builtin
                  active={activeThemeId === null}
                  swatchColors={['#15110D', '#D97757', '#5BC98A', '#7AB3F0']}
                  name="Aperture Dark"
                  author="built-in"
                  onClick={() => setActive(null)}
                />
                <ThemeCard
                  builtin
                  active={activeThemeId === 'aperture-light'}
                  swatchColors={['#FAF7F1', '#C8633B', '#2E8B6A', '#2E6FB8']}
                  name="Aperture Light"
                  author="built-in"
                  onClick={() => setActive('aperture-light')}
                />

                {themes.map((theme) => (
                  <ThemeCard
                    key={theme.id}
                    active={activeThemeId === theme.id}
                    swatchColors={[
                      `#${theme.base.base00}`,
                      `#${theme.base.base09}`,
                      `#${theme.base.base0b}`,
                      `#${theme.base.base0d}`,
                    ]}
                    name={theme.name}
                    author={theme.author ?? 'imported'}
                    onClick={() => setActive(theme.id)}
                    onDelete={() => requestDelete(theme.id)}
                    confirmingDelete={confirmDeleteId === theme.id}
                    onConfirmDelete={() => confirmDelete(theme.id)}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                  />
                ))}

                {/* Dashed-border import placeholder */}
                <button
                  onClick={handleImport}
                  disabled={isImporting}
                  className="border border-dashed border-app-border rounded-lg p-3 flex flex-col items-center justify-center gap-1.5 text-app-text-3 hover:text-app-text hover:border-app-border-2 transition-colors disabled:opacity-50"
                >
                  <Plus size={18} />
                  <span className="text-ui">Import theme</span>
                </button>
              </div>
            </>
          )}

          {section === 'updates' && <UpdatesSection onClose={onClose} />}
          {section === 'ai' && <AiSection onClose={onClose} />}
        </div>
      </div>
    </div>,
    document.body
  )
}

function UpdatesSection({ onClose }: { onClose: () => void }) {
  const status = useUpdateStore((s) => s.status)
  const checking = useUpdateStore((s) => s.checking)
  const checkNow = useUpdateStore((s) => s.checkNow)
  const [copied, setCopied] = useState(false)

  // Kick off a check the first time the panel is shown with no data yet.
  useEffect(() => {
    if (!status && !checking) void checkNow()
  }, [status, checking, checkNow])

  const copyXattr = async () => {
    await navigator.clipboard.writeText('xattr -cr /Applications/Aperture.app')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
        <div id="settings-modal-title-updates" className="text-ui-md font-semibold text-app-text">Updates</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="p-1.5 rounded-md text-app-text-3 hover:text-app-text hover:bg-app-elevated transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="p-4 overflow-y-auto flex flex-col gap-4">
        {/* Current version + manual check */}
        <div className="flex items-center justify-between">
          <div>
            <div className="app-section-label">Current version</div>
            <div className="text-ui-md font-semibold text-app-text font-tabular">
              {status?.currentVersion ?? '—'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void checkNow()}
            disabled={checking}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-app-elevated hover:bg-app-border/40 disabled:opacity-50 text-app-text rounded-md text-ui font-medium transition-colors"
          >
            <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
        </div>

        {/* Error */}
        {status?.error && (
          <div className="px-3 py-2 bg-app-err-subtle text-app-err rounded-md text-ui">
            Couldn't check for updates — {status.error}
          </div>
        )}

        {/* Up to date */}
        {status && !status.error && !status.updateAvailable && (
          <div className="flex items-center gap-2 px-3 py-2 bg-app-ok-subtle text-app-ok rounded-md text-ui">
            <Check size={14} />
            You're on the latest version.
          </div>
        )}

        {/* Update available */}
        {status?.updateAvailable && (
          <div className="flex flex-col gap-3 border border-app-accent rounded-lg p-3 bg-app-accent-subtle/40">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="app-section-label">New version available</div>
                <div className="text-ui-md font-semibold text-app-text font-tabular">{status.latestVersion}</div>
                {status.publishedAt && (
                  <div className="text-ui-xs text-app-text-3">
                    Released {new Date(status.publishedAt).toLocaleDateString()}
                  </div>
                )}
              </div>
              <a
                href={status.dmgUrl ?? status.releaseUrl ?? '#'}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-2.5 py-1 bg-app-accent hover:bg-app-accent-hover text-white rounded-md text-ui font-medium transition-colors shrink-0"
              >
                <Download size={12} />
                Download
              </a>
            </div>

            {status.releaseNotes && (
              <pre className="text-ui-xs text-app-text-2 whitespace-pre-wrap max-h-40 overflow-y-auto bg-app-surface rounded-md p-2 border border-app-border">
                {status.releaseNotes}
              </pre>
            )}

            {status.releaseUrl && (
              <a
                href={status.releaseUrl}
                target="_blank"
                rel="noreferrer"
                className="text-ui-xs text-app-accent-text hover:underline"
              >
                View release notes on GitHub →
              </a>
            )}

            {/* Un-notarized install hint */}
            <div className="text-ui-xs text-app-text-3 border-t border-app-border pt-2">
              After installing, if macOS says the app is "damaged", run this once in Terminal:
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 px-2 py-1 bg-app-surface border border-app-border rounded font-tabular text-app-text-2 truncate">
                  xattr -cr /Applications/Aperture.app
                </code>
                <button
                  type="button"
                  onClick={copyXattr}
                  className="px-2 py-1 rounded bg-app-elevated hover:bg-app-border/40 text-app-text-2 text-ui-xs shrink-0"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function AiSection({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<{ configured: boolean; maskedHint: string | null; model: string } | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [model, setModel] = useState('claude-sonnet-4-6')
  const [saved, setSaved] = useState(false)

  const inlineEnabled = useAiSettingsStore((s) => s.enabled)
  const inlineKeyConfigured = useAiSettingsStore((s) => s.keyConfigured)
  const setInlineEnabled = useAiSettingsStore((s) => s.setEnabled)
  const loadAiSettings = useAiSettingsStore((s) => s.load)

  useEffect(() => {
    void (async () => {
      const s = await window.api.invoke(CHANNELS.AI_CONFIG_GET, undefined)
      setStatus(s)
      setModel(s.model)
    })()
  }, [])

  const save = async () => {
    const payload: { apiKey?: string; model?: string } = { model }
    if (keyInput.trim()) payload.apiKey = keyInput.trim()
    const s = await window.api.invoke(CHANNELS.AI_CONFIG_SET, payload)
    setStatus(s)
    setKeyInput('')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    await loadAiSettings()
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
        <div id="settings-modal-title-ai" className="text-ui-md font-semibold text-app-text">AI Assistant</div>
        <button type="button" onClick={onClose} aria-label="Close settings"
          className="p-1.5 rounded-md text-app-text-3 hover:text-app-text hover:bg-app-elevated transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="p-4 overflow-y-auto flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="app-section-label">Anthropic API key</label>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={status?.configured ? `Configured (${status.maskedHint})` : 'sk-ant-…'}
            className="bg-app-surface border border-app-border rounded-md px-2 py-1.5 text-ui text-app-text focus:outline-none focus:ring-2 focus:ring-app-accent/30 font-tabular"
          />
          <p className="text-ui-xs text-app-text-3">Stored locally on this machine. Leave blank to keep the current key.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="app-section-label">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="bg-app-surface border border-app-border rounded-md px-2 py-1.5 text-ui text-app-text focus:outline-none focus:ring-2 focus:ring-app-accent/30"
          >
            <option value="claude-opus-4-8">Claude Opus 4.8 (most capable)</option>
            <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (balanced)</option>
            <option value="claude-haiku-4-5">Claude Haiku 4.5 (fastest)</option>
          </select>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col">
            <label className="app-section-label">Inline AI completions (experimental)</label>
            <p className="text-ui-xs text-app-text-3">
              Ghost-text suggestions as you type. Uses your key on every pause — small per-keystroke cost.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={inlineEnabled}
            disabled={!inlineKeyConfigured}
            onClick={() => void setInlineEnabled(!inlineEnabled)}
            className={`mt-0.5 shrink-0 w-9 h-5 rounded-full transition-colors disabled:opacity-40 ${
              inlineEnabled ? 'bg-app-accent' : 'bg-app-border'
            }`}
          >
            <span
              className={`block w-4 h-4 bg-white rounded-full transition-transform ${
                inlineEnabled ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={save}
            className="px-3 py-1.5 rounded-md text-ui font-medium bg-app-accent hover:bg-app-accent-hover text-white">
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>
    </>
  )
}

interface ThemeCardProps {
  active: boolean
  builtin?: boolean
  swatchColors: string[]
  name: string
  author: string
  onClick: () => void
  onDelete?: () => void
  confirmingDelete?: boolean
  onConfirmDelete?: () => void
  onCancelDelete?: () => void
}

function ThemeCard({
  active,
  builtin,
  swatchColors,
  name,
  author,
  onClick,
  onDelete,
  confirmingDelete,
  onConfirmDelete,
  onCancelDelete,
}: ThemeCardProps) {
  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`group relative cursor-pointer rounded-lg p-3 transition-colors text-left w-full ${
          active
            ? 'bg-app-accent-subtle border-2 border-app-accent'
            : 'bg-app-elevated border border-app-border hover:border-app-border-2'
        }`}
      >
        <div className="flex gap-1 mb-2">
          {swatchColors.map((c, i) => (
            <div
              key={i}
              className="w-5 h-5 rounded"
              style={{ backgroundColor: c, border: '1px solid rgba(0,0,0,0.05)' }}
            />
          ))}
        </div>
        <div className="text-ui font-semibold text-app-text truncate">{name}</div>
        <div className="text-ui-xs text-app-text-3 truncate">{author}</div>

        {active && (
          <div className="absolute top-2 right-2 app-dot" style={{ backgroundColor: 'rgb(var(--c-accent))' }} />
        )}
      </button>

      {!builtin && onDelete && (
        <>
          {confirmingDelete ? (
            <div className="absolute top-2 right-2 flex items-center gap-1 bg-app-surface rounded px-1 py-0.5 shadow-app-card">
              <button
                type="button"
                onClick={onCancelDelete}
                className="text-ui-xs px-1.5 py-0.5 text-app-text-2 hover:text-app-text"
              >
                No
              </button>
              <button
                type="button"
                onClick={onConfirmDelete}
                className="text-ui-xs px-1.5 py-0.5 rounded bg-app-err-subtle text-app-err"
              >
                Yes
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onDelete}
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded text-app-text-3 hover:text-app-err hover:bg-app-err-subtle/60 transition-all focus:opacity-100"
              title="Delete theme"
              aria-label={`Delete ${name}`}
            >
              <Trash2 size={11} />
            </button>
          )}
        </>
      )}
    </div>
  )
}
