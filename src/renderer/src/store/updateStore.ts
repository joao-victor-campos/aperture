import { create } from 'zustand'
import { CHANNELS } from '@shared/ipc'
import type { UpdateStatus } from '@shared/types'

interface UpdateState {
  status: UpdateStatus | null
  checking: boolean
  /** Manual "Check for updates" — invokes the main process and stores the result. */
  checkNow: () => Promise<void>
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: null,
  checking: false,

  checkNow: async () => {
    set({ checking: true })
    try {
      const status = await window.api.invoke(CHANNELS.UPDATES_CHECK, undefined)
      set({ status, checking: false })
    } catch (err) {
      // checkForUpdate normally returns its own error status; this only fires if
      // the IPC bridge itself fails. Preserve the known currentVersion.
      set({
        checking: false,
        status: {
          currentVersion: get().status?.currentVersion ?? '',
          latestVersion: null,
          updateAvailable: false,
          dmgUrl: null,
          releaseUrl: null,
          releaseNotes: null,
          publishedAt: null,
          checkedAt: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err),
        },
      })
    }
  },
}))

// ── Global UPDATES_STATUS push listener ─────────────────────────────────────
// Main process pushes an UpdateStatus on each scheduled check.
/** Exported so it can be unit-tested directly (see updateStore.test.ts). */
export function applyUpdateStatusPush(data: unknown): void {
  useUpdateStore.setState({ status: data as UpdateStatus })
}

window.api.on(CHANNELS.UPDATES_STATUS, applyUpdateStatusPush)
