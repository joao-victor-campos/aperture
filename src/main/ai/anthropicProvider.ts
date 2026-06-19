import Anthropic from '@anthropic-ai/sdk'
import type { ChatContentBlock } from '../../shared/types'
import { registerProvider, type LlmProvider } from './llmProvider'

/** Map our final-message content blocks (already Anthropic-shaped) to our type. */
function toContentBlocks(content: unknown[]): ChatContentBlock[] {
  const out: ChatContentBlock[] = []
  for (const raw of content) {
    const b = raw as Record<string, unknown>
    if (b.type === 'text') {
      out.push({ type: 'text', text: String(b.text ?? '') })
    } else if (b.type === 'tool_use') {
      out.push({
        type: 'tool_use',
        id: String(b.id),
        name: String(b.name),
        input: (b.input ?? {}) as Record<string, unknown>,
      })
    }
  }
  return out
}

export const anthropicProvider: LlmProvider = {
  async complete(params, apiKey, onDelta) {
    const client = new Anthropic({ apiKey })
    const stream = client.messages.stream({
      model: params.model,
      max_tokens: 4096,
      system: params.system,
      // Our ChatMessage shape mirrors Anthropic's MessageParam.
      messages: params.messages as unknown as Anthropic.MessageParam[],
      tools: params.tools as unknown as Anthropic.Tool[],
    })
    stream.on('text', (delta: string) => onDelta(delta))
    const final = await stream.finalMessage()
    return {
      message: { role: 'assistant', content: toContentBlocks(final.content) },
      stopReason: (final.stop_reason as string | null) ?? null,
    }
  },
}

registerProvider('anthropic', anthropicProvider)
