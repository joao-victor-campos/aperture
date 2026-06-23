/**
 * Format a byte count using decimal (1000-based) units: KB / MB / GB.
 * Single source of truth shared by the main and renderer processes.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(1)} KB`
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e9).toFixed(2)} GB`
}
