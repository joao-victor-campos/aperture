import { describe, it, expect } from 'vitest'
import { inlineSchemaContext } from '../../../renderer/src/lib/inlineSchemaContext'

const schema = {
  'sales.orders': ['id', 'total', 'user_id'],
  orders: ['id', 'total', 'user_id'],
  'sales.users': ['id', 'name'],
  users: ['id', 'name'],
}

describe('inlineSchemaContext', () => {
  it('lists the available catalog tables (dotted keys only, deduped)', () => {
    const out = inlineSchemaContext('SELECT 1', schema)
    expect(out).toContain('Available tables: sales.orders, sales.users')
    // Bare-name aliases are not listed as available tables.
    expect(out).not.toContain('Available tables: sales.orders, orders')
  })

  it('lists columns for tables referenced in the SQL', () => {
    const out = inlineSchemaContext('SELECT * FROM orders JOIN users ON 1=1', schema)
    expect(out).toContain('orders(id, total, user_id)')
    expect(out).toContain('users(id, name)')
  })

  it('returns only available tables when no referenced table resolves', () => {
    const out = inlineSchemaContext('SELECT * FROM unknown_table', schema)
    expect(out).toBe('Available tables: sales.orders, sales.users')
  })

  it('returns an empty string when the schema map is empty', () => {
    expect(inlineSchemaContext('SELECT * FROM orders', {})).toBe('')
  })

  it('caps the number of referenced-table column lines', () => {
    const out = inlineSchemaContext('SELECT * FROM orders JOIN users ON 1=1', schema, 1)
    // 1 "Available tables:" line + 1 referenced-column line.
    expect(out.split('\n')).toHaveLength(2)
  })

  it('caps the number of available tables listed', () => {
    const many: Record<string, string[]> = {}
    for (let i = 0; i < 60; i++) many[`ds.t${i}`] = ['c']
    const out = inlineSchemaContext('SELECT 1', many, 6, 5)
    const listed = out.replace('Available tables: ', '').split(', ')
    expect(listed).toHaveLength(5)
  })
})
