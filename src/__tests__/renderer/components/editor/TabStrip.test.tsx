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
})
