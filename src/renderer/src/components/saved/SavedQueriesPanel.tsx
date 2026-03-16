import { useEffect, useRef, useState } from 'react'
import {
  Search, X, FolderPlus, Folder, FolderOpen, ChevronRight, ChevronDown,
  FileText, MoreHorizontal, Trash2, Pencil, Check,
} from 'lucide-react'
import { useSavedQueryStore } from '../../store/savedQueryStore'
import { useQueryStore } from '../../store/queryStore'
import type { SavedQuery, Folder as FolderType } from '@shared/types'

export default function SavedQueriesPanel() {
  const { queries, folders, load, createFolder, renameFolder, deleteFolder, deleteQuery } =
    useSavedQueryStore()
  const { openTab } = useQueryStore()
  const [search, setSearch] = useState('')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => { load() }, [])

  const q = search.trim().toLowerCase()

  const matchesQuery = (sq: SavedQuery) =>
    !q || sq.title.toLowerCase().includes(q) || sq.sql.toLowerCase().includes(q)

  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleOpenQuery = (sq: SavedQuery) => {
    openTab({ title: sq.title, sql: sq.sql, connectionId: sq.connectionId, savedQueryId: sq.id })
  }

  const handleCreateFolder = async () => {
    const name = 'New Folder'
    const folder = await createFolder(name)
    setExpandedFolders((prev) => new Set([...prev, folder.id]))
    setRenamingFolderId(folder.id)
    setRenameValue(name)
  }

  const commitRename = async (folder: FolderType) => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== folder.name) {
      await renameFolder({ ...folder, name: trimmed })
    }
    setRenamingFolderId(null)
  }

  // Uncategorized queries (folderId === null or pointing to non-existent folder)
  const folderIds = new Set(folders.map((f) => f.id))
  const uncategorized = queries.filter(
    (q) => q.folderId === null || !folderIds.has(q.folderId!)
  )

  // Folder-scoped queries
  const queriesInFolder = (folderId: string) => queries.filter((q) => q.folderId === folderId)

  const visibleUncategorized = uncategorized.filter(matchesQuery)

  const visibleFolders = q
    ? folders.filter((f) => queriesInFolder(f.id).some(matchesQuery))
    : folders

  const isEmpty = queries.length === 0 && folders.length === 0

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="px-2 pt-2 pb-1 shrink-0">
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-app-elevated rounded border border-app-border">
          <Search size={11} className="text-app-text-3 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search queries…"
            className="flex-1 text-xs bg-transparent text-app-text placeholder-app-text-3 outline-none min-w-0"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-app-text-3 hover:text-app-text transition-colors">
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* New folder button */}
      <div className="px-2 pb-1 shrink-0">
        <button
          onClick={handleCreateFolder}
          className="flex items-center gap-1.5 text-[11px] text-app-text-3 hover:text-app-text transition-colors px-1 py-0.5 w-full"
        >
          <FolderPlus size={12} />
          New Folder
        </button>
      </div>

      {/* Query list */}
      <div className="flex-1 overflow-y-auto">
        {isEmpty && (
          <p className="px-3 pt-3 text-xs text-app-text-3">No saved queries yet.</p>
        )}

        {/* Folders */}
        {visibleFolders.map((folder) => {
          const folderQueries = queriesInFolder(folder.id).filter(matchesQuery)
          const isExpanded = q ? true : expandedFolders.has(folder.id)
          const isRenaming = renamingFolderId === folder.id

          return (
            <div key={folder.id}>
              <FolderRow
                folder={folder}
                isExpanded={isExpanded}
                isRenaming={isRenaming}
                renameValue={renameValue}
                onToggle={() => toggleFolder(folder.id)}
                onStartRename={() => { setRenamingFolderId(folder.id); setRenameValue(folder.name) }}
                onRenameChange={setRenameValue}
                onRenameCommit={() => commitRename(folder)}
                onDelete={() => deleteFolder(folder.id)}
              />
              {isExpanded && folderQueries.map((sq) => (
                <QueryRow key={sq.id} query={sq} indent onOpen={() => handleOpenQuery(sq)} onDelete={() => deleteQuery(sq.id)} />
              ))}
              {isExpanded && folderQueries.length === 0 && (
                <p className="pl-8 pr-3 py-1 text-[11px] text-app-text-3 italic">Empty</p>
              )}
            </div>
          )
        })}

        {/* Uncategorized */}
        {visibleUncategorized.length > 0 && (
          <>
            {folders.length > 0 && (
              <div className="px-3 pt-2 pb-0.5">
                <span className="text-[10px] uppercase tracking-wide text-app-text-3">Uncategorized</span>
              </div>
            )}
            {visibleUncategorized.map((sq) => (
              <QueryRow key={sq.id} query={sq} indent={false} onOpen={() => handleOpenQuery(sq)} onDelete={() => deleteQuery(sq.id)} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function FolderRow({
  folder, isExpanded, isRenaming, renameValue,
  onToggle, onStartRename, onRenameChange, onRenameCommit, onDelete,
}: {
  folder: FolderType
  isExpanded: boolean
  isRenaming: boolean
  renameValue: string
  onToggle: () => void
  onStartRename: () => void
  onRenameChange: (v: string) => void
  onRenameCommit: () => void
  onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const renameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isRenaming) { renameRef.current?.focus(); renameRef.current?.select() }
  }, [isRenaming])

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  return (
    <div className="group flex items-center gap-1 px-2 py-1 hover:bg-app-elevated/50 cursor-default select-none">
      <button onClick={onToggle} className="text-app-text-3 shrink-0">
        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {isExpanded
        ? <FolderOpen size={12} className="text-app-accent shrink-0" />
        : <Folder size={12} className="text-app-text-3 shrink-0" />
      }
      {isRenaming ? (
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <input
            ref={renameRef}
            type="text"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={onRenameCommit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameCommit()
              if (e.key === 'Escape') onRenameCommit()
            }}
            className="flex-1 min-w-0 text-xs bg-app-bg border border-app-accent rounded px-1 py-0.5 text-app-text outline-none"
          />
          <button onClick={onRenameCommit} className="text-app-accent shrink-0"><Check size={11} /></button>
        </div>
      ) : (
        <>
          <span onClick={onToggle} className="flex-1 text-xs text-app-text truncate">{folder.name}</span>
          <div ref={menuRef} className="relative shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
              className="p-0.5 text-app-text-3 hover:text-app-text rounded transition-colors"
            >
              <MoreHorizontal size={12} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-36 bg-app-elevated border border-app-border rounded shadow-lg z-10 py-0.5 text-xs">
                <button
                  onClick={() => { setMenuOpen(false); onStartRename() }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-app-text hover:bg-app-bg transition-colors"
                >
                  <Pencil size={11} /> Rename
                </button>
                <button
                  onClick={() => { setMenuOpen(false); onDelete() }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-red-400 hover:bg-app-bg transition-colors"
                >
                  <Trash2 size={11} /> Delete folder
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function QueryRow({
  query, indent, onOpen, onDelete,
}: {
  query: SavedQuery
  indent: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  return (
    <div className={`group flex items-center gap-1.5 py-1 hover:bg-app-elevated/50 cursor-default select-none ${indent ? 'pl-7 pr-2' : 'px-2'}`}>
      <FileText size={11} className="text-app-text-3 shrink-0" />
      <span
        onClick={onOpen}
        className="flex-1 text-xs text-app-text-2 hover:text-app-text truncate cursor-default"
        title={query.title}
      >
        {query.title}
      </span>
      <div ref={menuRef} className="relative shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
          className="p-0.5 text-app-text-3 hover:text-app-text rounded transition-colors"
        >
          <MoreHorizontal size={12} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-32 bg-app-elevated border border-app-border rounded shadow-lg z-10 py-0.5 text-xs">
            <button
              onClick={() => { setMenuOpen(false); onOpen() }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-app-text hover:bg-app-bg transition-colors"
            >
              Open
            </button>
            <button
              onClick={() => { setMenuOpen(false); onDelete() }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-red-400 hover:bg-app-bg transition-colors"
            >
              <Trash2 size={11} /> Delete
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
