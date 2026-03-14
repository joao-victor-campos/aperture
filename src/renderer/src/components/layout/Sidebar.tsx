import { useState } from 'react'
import { Database, BookMarked } from 'lucide-react'
import CatalogTree from '../catalog/CatalogTree'
import SavedQueriesPanel from '../saved/SavedQueriesPanel'

interface SidebarProps {
  onAddConnection: () => void
}

type Tab = 'catalog' | 'saved'

export default function Sidebar({ onAddConnection }: SidebarProps) {
  const [activeTab, setActiveTab] = useState<Tab>('catalog')

  return (
    <aside className="w-64 flex flex-col border-r border-app-border bg-app-surface shrink-0">
      <div className="flex border-b border-app-border shrink-0">
        <TabButton
          label="Catalog"
          icon={<Database size={13} />}
          active={activeTab === 'catalog'}
          onClick={() => setActiveTab('catalog')}
        />
        <TabButton
          label="Saved"
          icon={<BookMarked size={13} />}
          active={activeTab === 'saved'}
          onClick={() => setActiveTab('saved')}
        />
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {activeTab === 'catalog' ? (
          <CatalogTree onAddConnection={onAddConnection} />
        ) : (
          <SavedQueriesPanel />
        )}
      </div>
    </aside>
  )
}

function TabButton({
  label, icon, active, onClick,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs transition-colors ${
        active
          ? 'text-app-accent-text border-b-2 border-app-accent bg-app-elevated/40'
          : 'text-app-text-2 hover:text-app-text'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
