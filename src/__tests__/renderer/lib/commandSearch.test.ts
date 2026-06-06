import { describe, it, expect } from 'vitest'
import { rankCommands, groupByKind, type CommandItem } from '../../../renderer/src/lib/commandSearch'

const noop = () => {}

function makeItem(id: string, label: string, kind: CommandItem['kind'] = 'action'): CommandItem {
  return { id, kind, label, searchText: label.toLowerCase(), action: noop }
}

describe('rankCommands', () => {
  it('returns items unchanged when query is empty', () => {
    const items = [makeItem('1', 'Alpha'), makeItem('2', 'Beta')]
    expect(rankCommands(items, '')).toEqual(items)
  })

  it('returns items unchanged when query is whitespace', () => {
    const items = [makeItem('1', 'Alpha'), makeItem('2', 'Beta')]
    expect(rankCommands(items, '   ')).toEqual(items)
  })

  it('case-insensitive substring match', () => {
    const items = [
      makeItem('1', 'Run query'),
      makeItem('2', 'Toggle theme'),
      makeItem('3', 'New tab'),
    ]
    const result = rankCommands(items, 'TAB')
    expect(result.map((r) => r.id)).toEqual(['3'])
  })

  it('prefix match scores higher than mid-string match', () => {
    const items = [
      makeItem('1', 'my_dataset.users'),  // 'user' is at index ~11
      makeItem('2', 'users_v2'),           // 'user' is at index 0 (prefix)
    ]
    const result = rankCommands(items, 'user')
    expect(result.map((r) => r.id)).toEqual(['2', '1'])
  })

  it('stable sort within ties — preserves input order', () => {
    const items = [
      makeItem('a', 'event_a'),  // pos 0
      makeItem('b', 'event_b'),  // pos 0
      makeItem('c', 'event_c'),  // pos 0
    ]
    const result = rankCommands(items, 'event')
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('drops items that do not match', () => {
    const items = [
      makeItem('1', 'apple'),
      makeItem('2', 'banana'),
      makeItem('3', 'cherry'),
    ]
    const result = rankCommands(items, 'pear')
    expect(result).toHaveLength(0)
  })

  it('matches against full searchText (not just label)', () => {
    const item: CommandItem = {
      id: '1', kind: 'connection', label: 'prod_warehouse',
      searchText: 'switch prod_warehouse snowflake', action: noop,
    }
    const result = rankCommands([item], 'snowflake')
    expect(result).toHaveLength(1)
  })
})

describe('groupByKind', () => {
  it('groups items by their kind, preserving input order within each group', () => {
    const items: CommandItem[] = [
      { id: 't1', kind: 'table',  label: 'users',   searchText: 'users',   action: noop },
      { id: 'a1', kind: 'action', label: 'New tab', searchText: 'new tab', action: noop },
      { id: 't2', kind: 'table',  label: 'orders',  searchText: 'orders',  action: noop },
    ]
    const grouped = groupByKind(items)
    expect(grouped.table.map((i) => i.id)).toEqual(['t1', 't2'])
    expect(grouped.action.map((i) => i.id)).toEqual(['a1'])
    expect(grouped.saved).toHaveLength(0)
    expect(grouped.history).toHaveLength(0)
    expect(grouped.connection).toHaveLength(0)
  })

  it('returns an empty array per kind when no items match', () => {
    const grouped = groupByKind([])
    expect(grouped.table).toEqual([])
    expect(grouped.saved).toEqual([])
    expect(grouped.history).toEqual([])
    expect(grouped.connection).toEqual([])
    expect(grouped.action).toEqual([])
  })
})
