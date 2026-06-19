import { create } from 'zustand'
import { CHANNELS } from '@shared/ipc'

interface AiSettingsState {
  /** Whether inline AI completion is enabled in settings. */
  enabled: boolean
  /** Whether an API key is configured (completions are gated on this). */
  keyConfigured: boolean
  load: () => Promise<void>
  setEnabled: (value: boolean) => Promise<void>
}

export const useAiSettingsStore = create<AiSettingsState>((set) => ({
  enabled: false,
  keyConfigured: false,

  load: async () => {
    const status = await window.api.invoke(CHANNELS.AI_CONFIG_GET, undefined)
    set({ enabled: status.inlineCompletionEnabled, keyConfigured: status.configured })
  },

  setEnabled: async (value) => {
    const status = await window.api.invoke(CHANNELS.AI_CONFIG_SET, { inlineCompletionEnabled: value })
    set({ enabled: status.inlineCompletionEnabled, keyConfigured: status.configured })
  },
}))
