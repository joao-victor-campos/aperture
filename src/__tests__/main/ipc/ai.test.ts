import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'
import type { AiCompleteRequest } from '../../../shared/types'

type Handler = (event: unknown, req?: unknown) => unknown
const handlers = new Map<string, Handler>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) },
}))

type Store = { aiConfig: { apiKey: string | null; model: string } }
const storeData: Store = { aiConfig: { apiKey: null, model: 'claude-sonnet-4-6' } }
vi.mock('../../../main/db/store', () => ({
  store: {
    get: (k: string) => storeData[k as 'aiConfig'],
    set: (k: string, v: unknown) => { storeData[k as 'aiConfig'] = v as Store['aiConfig'] },
  },
}))

const complete = vi.fn()
vi.mock('../../../main/ai/llmProvider', () => ({
  getProvider: () => ({ complete }),
}))
vi.mock('../../../main/ai/anthropicProvider', () => ({ anthropicProvider: {} }))

import { registerAiHandlers } from '../../../main/ipc/ai'

function req(): AiCompleteRequest {
  return {
    requestId: 'r1',
    system: 'sys',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    tools: [],
  }
}

beforeEach(() => {
  handlers.clear()
  storeData.aiConfig = { apiKey: null, model: 'claude-sonnet-4-6' }
  complete.mockReset()
  registerAiHandlers()
})

describe('AI_CONFIG_GET', () => {
  it('reports unconfigured when no key', async () => {
    const res = await handlers.get(CHANNELS.AI_CONFIG_GET)!({})
    expect(res).toEqual({ configured: false, maskedHint: null, model: 'claude-sonnet-4-6' })
  })

  it('masks the key when configured', async () => {
    storeData.aiConfig = { apiKey: 'sk-secret-a1b2', model: 'claude-opus-4-8' }
    const res = await handlers.get(CHANNELS.AI_CONFIG_GET)!({})
    expect(res).toEqual({ configured: true, maskedHint: '…a1b2', model: 'claude-opus-4-8' })
  })
})

describe('AI_CONFIG_SET', () => {
  it('updates key + model and returns masked status', async () => {
    const res = await handlers.get(CHANNELS.AI_CONFIG_SET)!({}, { apiKey: 'sk-xyz9', model: 'claude-haiku-4-5' })
    expect(storeData.aiConfig.apiKey).toBe('sk-xyz9')
    expect(storeData.aiConfig.model).toBe('claude-haiku-4-5')
    expect(res).toEqual({ configured: true, maskedHint: '…xyz9', model: 'claude-haiku-4-5' })
  })

  it('updates only the model when apiKey omitted', async () => {
    storeData.aiConfig = { apiKey: 'sk-keep1234', model: 'claude-sonnet-4-6' }
    await handlers.get(CHANNELS.AI_CONFIG_SET)!({}, { model: 'claude-opus-4-8' })
    expect(storeData.aiConfig.apiKey).toBe('sk-keep1234')
    expect(storeData.aiConfig.model).toBe('claude-opus-4-8')
  })
})

describe('AI_CHAT_COMPLETE', () => {
  it('returns an error response when no API key is set', async () => {
    const res = await handlers.get(CHANNELS.AI_CHAT_COMPLETE)!({}, req())
    expect((res as { error?: string }).error).toMatch(/api key/i)
    expect(complete).not.toHaveBeenCalled()
  })

  it('calls the provider and streams deltas to the sender', async () => {
    storeData.aiConfig = { apiKey: 'sk-1234', model: 'claude-sonnet-4-6' }
    complete.mockImplementation(async (_p: unknown, _k: unknown, onDelta: (t: string) => void) => {
      onDelta('he'); onDelta('llo')
      return { message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }, stopReason: 'end_turn' }
    })
    const send = vi.fn()
    const res = await handlers.get(CHANNELS.AI_CHAT_COMPLETE)!({ sender: { send } }, req())

    expect(send).toHaveBeenNthCalledWith(1, CHANNELS.AI_CHAT_STREAM, { requestId: 'r1', delta: 'he' })
    expect(send).toHaveBeenNthCalledWith(2, CHANNELS.AI_CHAT_STREAM, { requestId: 'r1', delta: 'llo' })
    expect((res as { stopReason: string }).stopReason).toBe('end_turn')
  })

  it('returns an error response when the provider throws', async () => {
    storeData.aiConfig = { apiKey: 'sk-1234', model: 'claude-sonnet-4-6' }
    complete.mockRejectedValue(new Error('network down'))
    const res = await handlers.get(CHANNELS.AI_CHAT_COMPLETE)!({ sender: { send: vi.fn() } }, req())
    expect((res as { error?: string }).error).toBe('network down')
  })
})
