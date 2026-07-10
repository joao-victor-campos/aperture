import { useState } from 'react'
import CatalogTree from '../catalog/CatalogTree'
import SavedQueriesPanel from '../saved/SavedQueriesPanel'
import HistoryPanel from '../history/HistoryPanel'
import { useCatalogStore } from '../../store/catalogStore'
import { useConnectionStore } from '../../store/connectionStore'
import { useSavedQueryStore } from '../../store/savedQueryStore'

interface SidebarProps {
  onAddConnection: () => void
}

type Tab = 'catalog' | 'saved' | 'history'

const TABS: Tab[] = ['catalog', 'saved', 'history']

export default function Sidebar({ onAddConnection }: SidebarProps) {
  const [activeTab, setActiveTab] = useState<Tab>('catalog')

  // Inline counts for the segmented pill tabs (Atelier voice: small, muted)
  const { activeConnectionId } = useConnectionStore()
  const { datasetsByConnection } = useCatalogStore()
  const { queries } = useSavedQueryStore()
  const datasetCount = activeConnectionId
    ? (datasetsByConnection[activeConnectionId] ?? []).length
    : 0
  const savedCount = queries.length

  return (
    <aside
      className="w-[264px] flex flex-col border-r border-app-border bg-app-sidebar shrink-0"
    >
      {/* Segmented pill tabs */}
      <div
        className="px-2 pt-2 pb-2 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div
          className="app-segmented app-segmented--animated"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* Sliding active-pill background — one segment wide */}
          <div
            aria-hidden="true"
            className="app-segmented-indicator"
            style={{ transform: `translateX(${TABS.indexOf(activeTab) * 100}%)` }}
          />
          <button
            data-active={activeTab === 'catalog' || undefined}
            onClick={() => setActiveTab('catalog')}
          >
            Catalog{' '}
            <span className={activeTab === 'catalog' ? 'text-app-text-3' : 'text-app-text-4'}>
              {datasetCount}
            </span>
          </button>
          <button
            data-active={activeTab === 'saved' || undefined}
            onClick={() => setActiveTab('saved')}
          >
            Saved{' '}
            <span className={activeTab === 'saved' ? 'text-app-text-3' : 'text-app-text-4'}>
              {savedCount}
            </span>
          </button>
          <button
            data-active={activeTab === 'history' || undefined}
            onClick={() => setActiveTab('history')}
          >
            History
          </button>
        </div>
      </div>

      {/* key remounts the container on section change: replays the entrance
          animation and resets scroll to the top of the new section. */}
      <div key={activeTab} className="flex-1 overflow-y-auto min-h-0 animate-panel-in">
        {activeTab === 'catalog' && <CatalogTree onAddConnection={onAddConnection} />}
        {activeTab === 'saved' && <SavedQueriesPanel />}
        {activeTab === 'history' && <HistoryPanel />}
      </div>
    </aside>
  )
}
