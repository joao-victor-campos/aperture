import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '@shared/ipc'
import { useAiSettingsStore } from '../../../renderer/src/store/aiSettingsStore'

beforeEach(() => {
  useAiSettingsStore.setState({ enabled: false, keyConfigured: false })
  vi.mocked(window.api.invoke).mockReset()
})

describe('aiSettingsStore', () => {
  it('load() pulls enabled + keyConfigured from AI_CONFIG_GET', async () => {
    vi.mocked(window.api.invoke).mockResolvedValue({
      configured: true, maskedHint: '…1234', model: 'm', inlineCompletionEnabled: true,
    })
    await useAiSettingsStore.getState().load()
    expect(window.api.invoke).toHaveBeenCalledWith(CHANNELS.AI_CONFIG_GET, undefined)
    expect(useAiSettingsStore.getState().enabled).toBe(true)
    expect(useAiSettingsStore.getState().keyConfigured).toBe(true)
  })

  it('setEnabled() writes AI_CONFIG_SET and updates state from the response', async () => {
    vi.mocked(window.api.invoke).mockResolvedValue({
      configured: true, maskedHint: '…1234', model: 'm', inlineCompletionEnabled: true,
    })
    await useAiSettingsStore.getState().setEnabled(true)
    expect(window.api.invoke).toHaveBeenCalledWith(CHANNELS.AI_CONFIG_SET, { inlineCompletionEnabled: true })
    expect(useAiSettingsStore.getState().enabled).toBe(true)
    expect(useAiSettingsStore.getState().keyConfigured).toBe(true)
  })
})
