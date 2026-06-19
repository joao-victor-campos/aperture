import { describe, it, expect } from 'vitest'
import { inlineSchemaContext } from '../../../renderer/src/lib/inlineSchemaContext'

const schema = {
  'sales.orders': ['id', 'total', 'user_id'],
  orders: ['id', 'total', 'user_id'],
  users: ['id', 'name'],
}

describe('inlineSchemaContext', () => {
  it('lists columns for tables referenced in the SQL', () => {
    const out = inlineSchemaContext('SELECT * FROM orders JOIN users ON 1=1', schema)
    expect(out).toContain('orders(id, total, user_id)')
    expect(out).toContain('users(id, name)')
  })

  it('returns empty string when no referenced table is known', () => {
    expect(inlineSchemaContext('SELECT * FROM unknown_table', schema)).toBe('')
  })

  it('returns empty string when there are no table refs', () => {
    expect(inlineSchemaContext('SELECT 1', schema)).toBe('')
  })

  it('caps the number of tables included', () => {
    const many = 'SELECT * FROM orders JOIN users ON 1=1'
    expect(inlineSchemaContext(many, schema, 1).split('\n')).toHaveLength(1)
  })
})
