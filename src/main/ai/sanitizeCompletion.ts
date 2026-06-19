/**
 * Clean a raw model completion for inline insertion:
 * strip code fences, strip a leading echo of the prefix's last line,
 * cap the line count, and collapse whitespace-only output to ''.
 */
export function sanitizeCompletion(text: string, prefix: string, maxLines = 8): string {
  if (!text) return ''

  // Strip code fences (```sql ... ```).
  let out = text.replace(/```[\w]*\n?([\s\S]*?)\n?```/g, '$1').replace(/```[\w]*/g, '').replace(/```/g, '')

  // Strip a leading echo of the prefix's last line, if the model repeated it.
  const lastLine = prefix.split('\n').pop() ?? ''
  if (lastLine.trim() && out.startsWith(lastLine)) {
    out = out.slice(lastLine.length)
  }

  // Cap lines.
  const lines = out.split('\n')
  if (lines.length > maxLines) out = lines.slice(0, maxLines).join('\n')

  if (out.trim() === '') return ''
  return out
}
