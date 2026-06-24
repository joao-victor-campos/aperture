import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EditorPane from '@renderer/components/editor/EditorPane'
import { useQueryStore } from '@renderer/store/queryStore'

// Stub the heavy CodeMirror editor with a bare Run button that invokes onRun,
// so we can exercise EditorPane's run guard without mounting CodeMirror.
vi.mock('@renderer/components/editor/QueryEditor', () => ({
  default: ({ onRun }: { onRun: () => void }) => <button onClick={onRun}>run</button>,
}))

describe('EditorPane param run-guard', () => {
  beforeEach(() => {
    useQueryStore.setState({
      tabs: [],
      activeTabId: null,
      focusedGroup: 'left',
      activeByGroup: { left: null, right: null },
    })
    ;(window.api.invoke as ReturnType<typeof vi.fn>).mockReset?.()
  })
  afterEach(cleanup)

  it('blocks Run and shows the error at the input when a param is unfilled', () => {
    const id = useQueryStore.getState().openTab({ connectionId: 'c1' })
    useQueryStore.getState().updateTabSql(id, 'SELECT * FROM t WHERE c = {{country}} LIMIT 10')
    // Precondition: the {{country}} param was reconciled and is empty.
    expect(useQueryStore.getState().tabs.find((t) => t.id === id)?.params).toEqual([
      { name: 'country', type: 'text', value: '' },
    ])

    render(<EditorPane tabId={id} isSplit={false} onSplit={() => {}} onSave={() => {}} />)
    fireEvent.click(screen.getByText('run'))

    // Error shows at the input...
    expect(screen.getByText('Fill in {{country}} before running.')).toBeTruthy()
    // ...and the query never executed.
    expect(window.api.invoke).not.toHaveBeenCalledWith(
      expect.stringContaining('QUERY_EXECUTE'),
      expect.anything(),
    )
  })

  it('runs normally once the param is filled', () => {
    const id = useQueryStore.getState().openTab({ connectionId: 'c1' })
    useQueryStore.getState().updateTabSql(id, 'SELECT {{n}} LIMIT 10')
    useQueryStore.getState().setTabParams(id, [{ name: 'n', type: 'number', value: '5' }])

    render(<EditorPane tabId={id} isSplit={false} onSplit={() => {}} onSave={() => {}} />)
    fireEvent.click(screen.getByText('run'))

    expect(window.api.invoke).toHaveBeenCalled()
    expect(screen.queryByText(/before running/)).toBeNull()
  })
})
