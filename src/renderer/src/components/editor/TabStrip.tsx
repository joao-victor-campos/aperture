import { type MutableRefObject } from 'react'
import { Plus, X, Table2, Pin, Bookmark } from 'lucide-react'
import { useQueryStore, type GroupId } from '../../store/queryStore'
import { useConnectionStore } from '../../store/connectionStore'

interface TabStripProps {
  group: GroupId
  /** Shared between both strips so cross-group drags keep working. */
  dragTabIdRef: MutableRefObject<string | null>
}

export default function TabStrip({ group, dragTabIdRef }: TabStripProps) {
  const tabs = useQueryStore((s) => s.tabs)
  const activeByGroup = useQueryStore((s) => s.activeByGroup)
  const setActiveTab = useQueryStore((s) => s.setActiveTab)
  const closeTab = useQueryStore((s) => s.closeTab)
  const moveTabToGroup = useQueryStore((s) => s.moveTabToGroup)
  const focusGroup = useQueryStore((s) => s.focusGroup)
  const openTab = useQueryStore((s) => s.openTab)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)

  const groupTabs = tabs.filter((t) => (t.groupId ?? 'left') === group)
  const activeId = activeByGroup[group]

  return (
    <div
      className="flex items-center gap-1 px-2 h-10 border-b border-app-border bg-app-bg shrink-0 overflow-x-auto"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
      onDrop={(e) => {
        e.preventDefault()
        if (dragTabIdRef.current) moveTabToGroup(dragTabIdRef.current, group)
        dragTabIdRef.current = null
      }}
    >
      {groupTabs.map((tab) => {
        const isActive = activeId === tab.id
        return (
          <div
            key={tab.id}
            draggable
            onDragStart={(e) => { dragTabIdRef.current = tab.id; e.dataTransfer.effectAllowed = 'move' }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (dragTabIdRef.current && dragTabIdRef.current !== tab.id) {
                moveTabToGroup(dragTabIdRef.current, group, tab.id)
              }
              dragTabIdRef.current = null
            }}
            onDragEnd={() => { dragTabIdRef.current = null }}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-ui-sm cursor-grab active:cursor-grabbing transition-all shrink-0 ${
              isActive
                ? 'bg-app-surface text-app-text shadow-app-pill'
                : 'text-app-text-2 hover:text-app-text hover:bg-app-elevated/60'
            }`}
          >
            {tab.type === 'table' && <Table2 size={11} className="text-app-cat-green shrink-0" />}
            {tab.type === 'result' && <Pin size={11} className="text-app-accent shrink-0" />}
            {tab.savedQueryId && tab.type !== 'table' && tab.type !== 'result' && (
              <Bookmark size={11} className="text-app-accent shrink-0" />
            )}
            {!tab.type && tab.isRunning && (
              <span className="app-dot shrink-0 animate-pulse" style={{ backgroundColor: 'rgb(var(--c-accent))' }} />
            )}
            <span className="max-w-[140px] truncate">{tab.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
              className="text-app-text-3 hover:text-app-text transition-colors ml-0.5"
            >
              <X size={10} />
            </button>
          </div>
        )
      })}
      <button
        onClick={() => { focusGroup(group); openTab({ connectionId: activeConnectionId ?? undefined }) }}
        title="New query tab"
        className="p-1.5 rounded-md text-app-text-3 hover:text-app-text hover:bg-app-elevated transition-colors shrink-0"
      >
        <Plus size={13} />
      </button>
    </div>
  )
}
