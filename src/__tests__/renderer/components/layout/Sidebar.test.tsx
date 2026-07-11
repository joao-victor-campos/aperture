import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The three panels pull in stores/IPC — stub them with recognizable markers.
vi.mock('@renderer/components/catalog/CatalogTree', () => ({
  default: () => <div>CatalogTree-mock</div>,
}))
vi.mock('@renderer/components/saved/SavedQueriesPanel', () => ({
  default: () => <div>SavedQueriesPanel-mock</div>,
}))
vi.mock('@renderer/components/history/HistoryPanel', () => ({
  default: () => <div>HistoryPanel-mock</div>,
}))

import Sidebar from '@renderer/components/layout/Sidebar'

afterEach(cleanup)

const indicator = () =>
  document.querySelector('.app-segmented-indicator') as HTMLElement

describe('Sidebar section animation', () => {
  it('starts on Catalog with the indicator at the first slot', () => {
    render(<Sidebar onAddConnection={() => {}} />)
    expect(screen.getByText('CatalogTree-mock')).toBeTruthy()
    expect(indicator().style.transform).toBe('translateX(0%)')
  })

  it('clicking Saved slides the indicator and swaps the content', () => {
    render(<Sidebar onAddConnection={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /saved/i }))
    expect(indicator().style.transform).toBe('translateX(100%)')
    expect(screen.getByText('SavedQueriesPanel-mock')).toBeTruthy()
    expect(screen.queryByText('CatalogTree-mock')).toBeNull()
  })

  it('clicking History moves the indicator to the third slot', () => {
    render(<Sidebar onAddConnection={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /history/i }))
    expect(indicator().style.transform).toBe('translateX(200%)')
    expect(screen.getByText('HistoryPanel-mock')).toBeTruthy()
  })

  it('remounts the content wrapper on section change so the animation replays', () => {
    render(<Sidebar onAddConnection={() => {}} />)
    const before = screen.getByText('CatalogTree-mock').parentElement
    expect(before?.className).toContain('animate-panel-in')
    fireEvent.click(screen.getByRole('button', { name: /saved/i }))
    const after = screen.getByText('SavedQueriesPanel-mock').parentElement
    expect(after?.className).toContain('animate-panel-in')
    expect(after).not.toBe(before) // key change ⇒ new DOM node
  })
})
