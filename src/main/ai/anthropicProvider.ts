import Anthropic from '@anthropic-ai/sdk'
import type { ChatContentBlock } from '../../shared/types'
import { registerProvider, type LlmProvider } from './llmProvider'

/** Fast model used for inline ghost-text completion. */
const INLINE_MODEL = 'claude-haiku-4-5-20251001'

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

  async completeInline(params, apiKey) {
    const client = new Anthropic({ apiKey })
    const res = await client.messages.create({
      model: INLINE_MODEL,
      max_tokens: 256,
      temperature: 0.1,
      system: params.system,
      messages: [{ role: 'user', content: params.prompt }],
      stop_sequences: [';', '\n\n'],
    })
    const text = (res.content as unknown[])
      .map((b) => {
        const block = b as { type: string; text?: string }
        return block.type === 'text' ? (block.text ?? '') : ''
      })
      .join('')
    return { text }
  },
}

registerProvider('anthropic', anthropicProvider)
