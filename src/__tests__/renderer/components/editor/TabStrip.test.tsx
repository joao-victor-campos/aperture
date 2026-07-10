import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import TabStrip from '@renderer/components/editor/TabStrip'
import { useQueryStore } from '@renderer/store/queryStore'

afterEach(cleanup)

beforeEach(() => {
  useQueryStore.setState({
    tabs: [],
    activeTabId: null,
    focusedGroup: 'left',
    activeByGroup: { left: null, right: null },
  })
})

const openTab = (title: string) => useQueryStore.getState().openTab({ title })

describe('TabStrip', () => {
  it('renders only the tabs belonging to its group', () => {
    openTab('Tab A')
    const idB = openTab('Tab B')
    useQueryStore.getState().moveTabToGroup(idB, 'right')
    render(<TabStrip group="left" dragTabIdRef={{ current: null }} />)
    expect(screen.getByText('Tab A')).toBeTruthy()
    expect(screen.queryByText('Tab B')).toBeNull()
  })

  it('clicking a tab makes it the group-active tab', () => {
    const idA = openTab('Tab A')
    openTab('Tab B') // B is active after opening
    render(<TabStrip group="left" dragTabIdRef={{ current: null }} />)
    fireEvent.click(screen.getByText('Tab A'))
    expect(useQueryStore.getState().activeByGroup.left).toBe(idA)
  })

  // jsdom has no real DataTransfer; a plain object is enough for our handlers.
  const dataTransfer = { dropEffect: 'none', effectAllowed: 'all' }
  const tabEl = (title: string) =>
    screen.getByText(title).closest('[draggable="true"]') as HTMLElement

  it('shows the drop indicator on the hovered tab during a drag', () => {
    openTab('Tab A')
    const idB = openTab('Tab B')
    const dragRef = { current: null as string | null }
    render(<TabStrip group="left" dragTabIdRef={dragRef} />)
    dragRef.current = idB
    fireEvent.dragOver(tabEl('Tab A'), { dataTransfer })
    expect(tabEl('Tab A').getAttribute('data-drop-target')).toBe('true')
    expect(tabEl('Tab B').getAttribute('data-drop-target')).toBeNull()
  })

  it('does not mark the dragged tab itself as a drop target', () => {
    const idA = openTab('Tab A')
    openTab('Tab B')
    const dragRef = { current: null as string | null }
    render(<TabStrip group="left" dragTabIdRef={dragRef} />)
    dragRef.current = idA
    fireEvent.dragOver(tabEl('Tab A'), { dataTransfer })
    expect(document.querySelector('[data-drop-target="true"]')).toBeNull()
  })

  it('dropping on a tab moves the dragged tab before it and clears the indicator', () => {
    const idA = openTab('Tab A')
    const idB = openTab('Tab B')
    const dragRef = { current: null as string | null }
    render(<TabStrip group="left" dragTabIdRef={dragRef} />)
    dragRef.current = idB
    fireEvent.dragOver(tabEl('Tab A'), { dataTransfer })
    fireEvent.drop(tabEl('Tab A'), { dataTransfer })
    const leftIds = useQueryStore
      .getState()
      .tabs.filter((t) => (t.groupId ?? 'left') === 'left')
      .map((t) => t.id)
    expect(leftIds).toEqual([idB, idA])
    expect(document.querySelector('[data-drop-target="true"]')).toBeNull()
    expect(dragRef.current).toBeNull()
  })

  it('dragging over the strip blank area marks the new-tab button as the end target', () => {
    const idA = openTab('Tab A')
    openTab('Tab B')
    const dragRef = { current: null as string | null }
    render(<TabStrip group="left" dragTabIdRef={dragRef} />)
    dragRef.current = idA
    const strip = screen.getByTitle('New query tab').parentElement as HTMLElement
    fireEvent.dragOver(strip, { dataTransfer })
    expect(screen.getByTitle('New query tab').getAttribute('data-drop-target')).toBe('true')
  })

  it('dragend clears the indicator without reordering', () => {
    openTab('Tab A')
    const idB = openTab('Tab B')
    const dragRef = { current: null as string | null }
    render(<TabStrip group="left" dragTabIdRef={dragRef} />)
    dragRef.current = idB
    fireEvent.dragOver(tabEl('Tab A'), { dataTransfer })
    fireEvent.dragEnd(tabEl('Tab A'))
    expect(document.querySelector('[data-drop-target="true"]')).toBeNull()
    expect(dragRef.current).toBeNull()
  })

  it('tabs carry data-flip-id for the FLIP settle animation', () => {
    const idA = openTab('Tab A')
    render(<TabStrip group="left" dragTabIdRef={{ current: null }} />)
    const flipEl = screen.getByText('Tab A').closest('[data-flip-id]') as HTMLElement
    expect(flipEl).toBeTruthy()
    expect(flipEl.dataset.flipId).toBe(idA)
    expect(flipEl.getAttribute('draggable')).toBe('true') // same element that drags
  })
})
