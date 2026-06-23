import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EditorView } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'
import type { ConnectionEngine } from '@shared/types'
import { inlineCompletion, type InlineCompletionConfig } from '../../../renderer/src/lib/inlineCompletion'

const DEBOUNCE_MS = 400

interface Harness {
  view: EditorView
  request: ReturnType<typeof vi.fn>
}

function mount(opts: {
  doc?: string
  enabled?: boolean
  engine?: ConnectionEngine | undefined
  schema?: Record<string, string[]>
  reply?: string
} = {}): Harness {
  const request = vi.fn(async () => opts.reply ?? ' completed')
  const config: InlineCompletionConfig = {
    isEnabled: () => opts.enabled ?? true,
    getEngine: () => ('engine' in opts ? opts.engine : 'bigquery'),
    getSchema: () => opts.schema ?? {},
    request: request as InlineCompletionConfig['request'],
  }
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const ext: Extension = inlineCompletion(config)
  const view = new EditorView({
    state: EditorState.create({ doc: opts.doc ?? '', extensions: [ext] }),
    parent,
  })
  return { view, request }
}

/** Insert text at the cursor — triggers the plugin's docChanged → debounce path. */
function type(view: EditorView, text: string): void {
  const pos = view.state.selection.main.head
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
  })
}

/** Replace the entire document with `next`, keeping the cursor at the end. */
function setDoc(view: EditorView, next: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: next },
    selection: { anchor: next.length },
  })
}

function ghostText(view: EditorView): string | null {
  return view.dom.querySelector('.cm-inline-ghost')?.textContent ?? null
}

function pressKey(view: EditorView, key: string): void {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  )
}

describe('inlineCompletion', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('returns an array of three extensions (field, plugin, keymap)', () => {
    const ext = inlineCompletion({
      isEnabled: () => true,
      getEngine: () => 'bigquery',
      getSchema: () => ({}),
      request: async () => '',
    })
    expect(Array.isArray(ext)).toBe(true)
    expect((ext as unknown[]).length).toBe(3)
  })

  it('requests a completion and renders ghost text after the debounce', async () => {
    const { view, request } = mount({ reply: ' FROM users' })
    type(view, 'SELECT *')
    expect(request).not.toHaveBeenCalled() // debounce not elapsed yet

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: 'SELECT *', suffix: '', engine: 'bigquery' }),
    )
    expect(ghostText(view)).toBe(' FROM users')
  })

  it('passes a schema snippet derived from the document', async () => {
    const { view, request } = mount({ schema: { 'sales.orders': ['id', 'total'] } })
    type(view, 'SELECT * FROM orders')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(request).toHaveBeenCalledTimes(1)
    const { schema } = request.mock.calls[0][0] as { schema: string }
    expect(schema).toContain('sales.orders')
  })

  it('does not fire when disabled', async () => {
    const { view, request } = mount({ enabled: false })
    type(view, 'SELECT 1')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2)
    expect(request).not.toHaveBeenCalled()
    expect(ghostText(view)).toBeNull()
  })

  it('does not fire without an engine', async () => {
    const { view, request } = mount({ engine: undefined })
    type(view, 'SELECT 1')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(request).not.toHaveBeenCalled()
  })

  it('does not fire for a blank document', async () => {
    const { view, request } = mount({ doc: '' })
    type(view, '   ') // whitespace only → trimmed empty
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(request).not.toHaveBeenCalled()
  })

  it('debounces rapid edits into a single request', async () => {
    const { view, request } = mount()
    type(view, 'S')
    await vi.advanceTimersByTimeAsync(100)
    type(view, 'E')
    await vi.advanceTimersByTimeAsync(100)
    type(view, 'L')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('caches by prefix so a repeated state does not re-request', async () => {
    const { view, request } = mount()
    setDoc(view, 'SELECT a')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    setDoc(view, 'SELECT ab')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(request).toHaveBeenCalledTimes(2)

    // Returning to a previously-seen state hits the cache — no third call.
    setDoc(view, 'SELECT a')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('accepts the suggestion with Tab', async () => {
    const { view } = mount({ doc: '', reply: 'ELECT 1' })
    type(view, 'S')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(ghostText(view)).toBe('ELECT 1')

    pressKey(view, 'Tab')

    expect(view.state.doc.toString()).toBe('SELECT 1')
    expect(view.state.selection.main.head).toBe('SELECT 1'.length)
    expect(ghostText(view)).toBeNull()
  })

  it('dismisses the suggestion with Escape without changing the document', async () => {
    const { view } = mount({ doc: '', reply: ' more' })
    type(view, 'SELECT 1')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(ghostText(view)).toBe(' more')

    pressKey(view, 'Escape')

    expect(ghostText(view)).toBeNull()
    expect(view.state.doc.toString()).toBe('SELECT 1')
  })

  it('renders no ghost when the provider returns an empty string', async () => {
    const { view, request } = mount({ reply: '' })
    type(view, 'SELECT 1')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(request).toHaveBeenCalledTimes(1)
    expect(ghostText(view)).toBeNull()
  })

  it('swallows a provider rejection without rendering ghost text', async () => {
    const { view, request } = mount()
    request.mockRejectedValueOnce(new Error('network'))
    type(view, 'SELECT 1')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(ghostText(view)).toBeNull()
  })
})
