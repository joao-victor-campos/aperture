import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the SDK: messages.stream returns an object with .on('text') + finalMessage().
const onText = vi.fn()
const finalMessage = vi.fn()
const streamFn = vi.fn(() => ({
  on: (evt: string, cb: (d: string) => void) => { if (evt === 'text') onText.mockImplementation(cb) },
  finalMessage,
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: streamFn }
    constructor(_opts: unknown) {}
  },
}))

import { anthropicProvider } from '../../../main/ai/anthropicProvider'

beforeEach(() => {
  streamFn.mockClear()
  finalMessage.mockReset()
})

describe('anthropicProvider.complete', () => {
  it('passes model/system/messages/tools to the SDK and returns the mapped final message', async () => {
    finalMessage.mockResolvedValue({
      content: [
        { type: 'text', text: 'hello' },
        { type: 'tool_use', id: 'tu_1', name: 'search_tables', input: { query: 'orders' } },
      ],
      stop_reason: 'tool_use',
    })

    const result = await anthropicProvider.complete(
      {
        model: 'claude-sonnet-4-6',
        system: 'You are helpful',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        tools: [{ name: 'search_tables', description: 'd', input_schema: { type: 'object' } }],
      },
      'sk-test',
      () => {}
    )

    expect(streamFn).toHaveBeenCalledOnce()
    const arg = streamFn.mock.calls[0][0] as Record<string, unknown>
    expect(arg.model).toBe('claude-sonnet-4-6')
    expect(arg.system).toBe('You are helpful')
    expect(result.stopReason).toBe('tool_use')
    expect(result.message.role).toBe('assistant')
    expect(result.message.content).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'tool_use', id: 'tu_1', name: 'search_tables', input: { query: 'orders' } },
    ])
  })
})
