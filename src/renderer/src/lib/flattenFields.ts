import type { TableField } from '@shared/types'

/** A schema field plus its nesting depth, for flat table rendering. */
export interface FlatField {
  field: TableField
  depth: number
}

/**
 * Depth-first flatten of a (possibly nested RECORD/STRUCT) schema into rows.
 * Each field is emitted before its children; children carry depth + 1.
 */
export function flattenFields(fields: TableField[], depth = 0): FlatField[] {
  const result: FlatField[] = []
  for (const f of fields) {
    result.push({ field: f, depth })
    if (f.fields?.length) result.push(...flattenFields(f.fields, depth + 1))
  }
  return result
}
