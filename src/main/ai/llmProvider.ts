import type { ChatMessage, AiToolDef } from '../../shared/types'

export interface LlmCompleteParams {
  model: string
  system: string
  messages: ChatMessage[]
  tools: AiToolDef[]
}

export interface LlmCompleteResult {
  message: ChatMessage
  stopReason: string | null
}

export interface InlineCompleteParams {
  system: string
  /** The full user prompt (fill-in-the-middle framing). */
  prompt: string
}

/** A pluggable LLM backend. Anthropic is the only impl for v1. */
export interface LlmProvider {
  /**
   * Run one completion turn. Calls onDelta for each streamed text fragment,
   * resolves with the full assistant message (text + tool_use blocks).
   */
  complete(
    params: LlmCompleteParams,
    apiKey: string,
    onDelta: (text: string) => void
  ): Promise<LlmCompleteResult>

  /**
   * Single-shot, low-latency completion for inline ghost text. Non-streaming.
   * The provider chooses its own fast model internally.
   */
  completeInline(params: InlineCompleteParams, apiKey: string): Promise<{ text: string }>
}

const registry: Record<string, LlmProvider> = {}

export function registerProvider(id: string, provider: LlmProvider): void {
  registry[id] = provider
}

export function getProvider(id: string): LlmProvider {
  const p = registry[id]
  if (!p) throw new Error(`Unknown LLM provider: ${id}`)
  return p
}
