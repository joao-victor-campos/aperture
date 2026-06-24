import type { QueryParam } from '@shared/types'

/**
 * Returns an error message for an invalid {{name}} param value, or null if valid.
 * Rules mirror substituteParams: text/number/boolean require a non-empty,
 * type-valid value; raw may be empty. Messages match substituteParams verbatim.
 */
export function validateParam(p: QueryParam): string | null {
  if (p.type === 'raw') return null // empty allowed
  if (p.value.trim() === '') return `Fill in {{${p.name}}} before running.`
  switch (p.type) {
    case 'text':
      return null
    case 'number':
      return Number.isFinite(Number(p.value)) ? null : `{{${p.name}}} is not a valid number.`
    case 'boolean': {
      const low = p.value.trim().toLowerCase()
      return low === 'true' || low === 'false' ? null : `{{${p.name}}} must be true or false.`
    }
  }
  return null
}

/** All invalid params, in input order. */
export function validateParams(params: QueryParam[]): { name: string; message: string }[] {
  const out: { name: string; message: string }[] = []
  for (const p of params) {
    const message = validateParam(p)
    if (message) out.push({ name: p.name, message })
  }
  return out
}
