import { ipcMain } from 'electron'
import { CHANNELS } from '../../shared/ipc'
import { store } from '../db/store'
import { getProvider } from '../ai/llmProvider'
import type { AiCompleteRequest, AiCompleteResponse, AiConfigStatus, AiConfigSet, InlineCompleteRequest, InlineCompleteResponse } from '../../shared/types'
// Side-effect import: registers the 'anthropic' provider.
import '../ai/anthropicProvider'
import { buildInlinePrompt } from '../ai/buildInlinePrompt'
import { sanitizeCompletion } from '../ai/sanitizeCompletion'

function statusOf(cfg: { apiKey: string | null; model: string; inlineCompletionEnabled?: boolean }): AiConfigStatus {
  return {
    configured: !!cfg.apiKey,
    maskedHint: cfg.apiKey ? `…${cfg.apiKey.slice(-4)}` : null,
    model: cfg.model,
    inlineCompletionEnabled: !!cfg.inlineCompletionEnabled,
  }
}

export function registerAiHandlers(): void {
  ipcMain.handle(CHANNELS.AI_CONFIG_GET, async (): Promise<AiConfigStatus> => {
    return statusOf(store.get('aiConfig'))
  })

  ipcMain.handle(CHANNELS.AI_CONFIG_SET, async (_event, req: AiConfigSet): Promise<AiConfigStatus> => {
    const cfg = store.get('aiConfig')
    const next = {
      apiKey: req.apiKey !== undefined ? req.apiKey : cfg.apiKey,
      model: req.model !== undefined ? req.model : cfg.model,
      inlineCompletionEnabled:
        req.inlineCompletionEnabled !== undefined
          ? req.inlineCompletionEnabled
          : (cfg.inlineCompletionEnabled ?? false),
    }
    store.set('aiConfig', next)
    return statusOf(next)
  })

  ipcMain.handle(
    CHANNELS.AI_CHAT_COMPLETE,
    async (event, req: AiCompleteRequest): Promise<AiCompleteResponse> => {
      const cfg = store.get('aiConfig')
      if (!cfg.apiKey) {
        return {
          message: { role: 'assistant', content: [] },
          stopReason: null,
          error: 'No API key configured. Add one in Settings → AI.',
        }
      }
      try {
        const provider = getProvider('anthropic')
        const result = await provider.complete(
          { model: cfg.model, system: req.system, messages: req.messages, tools: req.tools },
          cfg.apiKey,
          (delta) => event.sender.send(CHANNELS.AI_CHAT_STREAM, { requestId: req.requestId, delta })
        )
        return { message: result.message, stopReason: result.stopReason }
      } catch (err) {
        return {
          message: { role: 'assistant', content: [] },
          stopReason: null,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }
  )

  ipcMain.handle(
    CHANNELS.AI_COMPLETE_INLINE,
    async (_event, req: InlineCompleteRequest): Promise<InlineCompleteResponse> => {
      const cfg = store.get('aiConfig')
      if (!cfg.apiKey) return { text: '' }
      try {
        const provider = getProvider('anthropic')
        const { system, user } = buildInlinePrompt(req)
        const { text } = await provider.completeInline({ system, prompt: user }, cfg.apiKey)
        return { text: sanitizeCompletion(text, req.prefix) }
      } catch (err) {
        return { text: '', error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}
