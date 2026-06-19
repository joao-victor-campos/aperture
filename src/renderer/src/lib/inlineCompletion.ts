import { StateField, StateEffect, Prec, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, Decoration, WidgetType, keymap, type ViewUpdate, type DecorationSet } from '@codemirror/view'
import type { ConnectionEngine } from '@shared/types'
import { inlineSchemaContext } from './inlineSchemaContext'

const DEBOUNCE_MS = 400
const CACHE_MAX = 50

export interface InlineCompletionConfig {
  /** Whether completions should fire (enabled AND key configured). */
  isEnabled: () => boolean
  getEngine: () => ConnectionEngine | undefined
  /** Table → columns map (the editor's sqlSchema). */
  getSchema: () => Record<string, string[]>
  /** Calls the main process; returns the suggestion text ('' = none). */
  request: (req: {
    requestId: string
    prefix: string
    suffix: string
    engine: ConnectionEngine
    schema: string
  }) => Promise<string>
}

interface Ghost {
  text: string
  pos: number
}

const setGhost = StateEffect.define<Ghost | null>()

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  eq(other: GhostWidget): boolean {
    return other.text === this.text
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-inline-ghost'
    span.style.opacity = '0.45'
    span.style.whiteSpace = 'pre'
    span.textContent = this.text
    return span
  }
  ignoreEvent(): boolean {
    return false
  }
}

const ghostField = StateField.define<Ghost | null>({
  create() {
    return null
  },
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setGhost)) return e.value
    // Any edit or cursor move clears the ghost (acceptance carries setGhost(null)).
    if (tr.docChanged || tr.selection) return null
    return value
  },
  provide: (f) =>
    EditorView.decorations.from(f, (v): DecorationSet =>
      v
        ? Decoration.set([
            Decoration.widget({ widget: new GhostWidget(v.text), side: 1 }).range(v.pos),
          ])
        : Decoration.none
    ),
})

const acceptKeymap = Prec.highest(
  keymap.of([
    {
      key: 'Tab',
      run: (view) => {
        const g = view.state.field(ghostField, false)
        if (!g) return false
        view.dispatch({
          changes: { from: g.pos, insert: g.text },
          selection: { anchor: g.pos + g.text.length },
          effects: setGhost.of(null),
        })
        return true
      },
    },
    {
      key: 'Escape',
      run: (view) => {
        if (!view.state.field(ghostField, false)) return false
        view.dispatch({ effects: setGhost.of(null) })
        return true
      },
    },
  ])
)

/**
 * Copilot-style inline ghost-text completion. Self-contained: debounces, caches,
 * cancels stale requests, renders ghost text, and binds Tab (accept) / Esc (dismiss).
 * The IPC call is injected via `config.request` so this stays testable/decoupled.
 */
export function inlineCompletion(config: InlineCompletionConfig): Extension {
  const cache = new Map<string, string>()

  const plugin = ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | null = null
      gen = 0

      update(update: ViewUpdate): void {
        if (update.docChanged) this.schedule(update.view)
      }

      schedule(view: EditorView): void {
        if (this.timer) clearTimeout(this.timer)
        if (!config.isEnabled()) return
        this.timer = setTimeout(() => void this.fetch(view), DEBOUNCE_MS)
      }

      async fetch(view: EditorView): Promise<void> {
        const engine = config.getEngine()
        if (!engine || !config.isEnabled()) return

        const docAtRequest = view.state.doc.toString()
        if (!docAtRequest.trim()) return
        const pos = view.state.selection.main.head
        const prefix = docAtRequest.slice(0, pos)
        const suffix = docAtRequest.slice(pos)

        const cacheKey = `${engine} ${prefix} ${suffix}`
        let text = cache.get(cacheKey)

        if (text === undefined) {
          const schema = inlineSchemaContext(docAtRequest, config.getSchema())
          const requestId = String(++this.gen)
          try {
            text = await config.request({ requestId, prefix, suffix, engine, schema })
          } catch {
            return
          }
          // Drop if a newer request started while we awaited.
          if (requestId !== String(this.gen)) return
          cache.set(cacheKey, text)
          if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
        }

        // Drop if the user moved or edited while we awaited.
        if (view.state.doc.toString() !== docAtRequest) return
        if (view.state.selection.main.head !== pos) return
        if (!text) return

        view.dispatch({ effects: setGhost.of({ text, pos }) })
      }

      destroy(): void {
        if (this.timer) clearTimeout(this.timer)
      }
    }
  )

  return [ghostField, plugin, acceptKeymap]
}
