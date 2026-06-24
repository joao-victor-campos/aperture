import { render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EditorPane from '@renderer/components/editor/EditorPane'
import { useQueryStore } from '@renderer/store/queryStore'

// QueryEditor mounts CodeMirror, which is heavy and irrelevant here. The
// regression under test lives in EditorPane's own `useShallow` selector, so we
// stub the editor child to isolate it (and to keep the test fast in jsdom).
vi.mock('@renderer/components/editor/QueryEditor', () => ({
  default: () => null,
}))

describe('EditorPane', () => {
  beforeEach(() => {
    // Reset the store to a clean slate so each test opens its own tab.
    useQueryStore.setState({
      tabs: [],
      activeTabId: null,
      focusedGroup: 'left',
      activeByGroup: { left: null, right: null },
    })
  })

  afterEach(() => {
    cleanup()
  })

  // Regression guard: a freshly-opened tab has `params === undefined`. The
  // selector must fall back to a *stable* empty array — returning a fresh `[]`
  // each render makes useSyncExternalStore's snapshot change every render, which
  // React surfaces as "Maximum update depth exceeded" (a blank screen at boot).
  it('mounts a tab with no params without an infinite render loop', () => {
    const id = useQueryStore.getState().openTab({ connectionId: 'c1' })
    // Precondition: this is the exact trigger — the tab carries no params.
    expect(useQueryStore.getState().tabs.find((t) => t.id === id)?.params).toBeUndefined()

    expect(() =>
      render(<EditorPane tabId={id} isSplit={false} onSplit={() => {}} onSave={() => {}} />),
    ).not.toThrow()
  })
})
