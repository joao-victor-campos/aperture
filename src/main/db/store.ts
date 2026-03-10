import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import type { Connection, SavedQuery, Folder } from '../../shared/types'

interface StoreData {
  connections: Connection[]
  savedQueries: SavedQuery[]
  folders: Folder[]
}

const DEFAULTS: StoreData = {
  connections: [],
  savedQueries: [],
  folders: []
}

let data: StoreData | null = null

function getStorePath(): string {
  return join(app.getPath('userData'), 'aperture-store.json')
}

function load(): StoreData {
  const path = getStorePath()
  if (!existsSync(path)) return { ...DEFAULTS }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as StoreData
  } catch {
    return { ...DEFAULTS }
  }
}

function persist(d: StoreData): void {
  const path = getStorePath()
  const dir = path.substring(0, path.lastIndexOf('/'))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(d, null, 2), 'utf-8')
}

export const store = {
  get<K extends keyof StoreData>(key: K): StoreData[K] {
    if (!data) data = load()
    return data[key] ?? DEFAULTS[key]
  },
  set<K extends keyof StoreData>(key: K, value: StoreData[K]): void {
    if (!data) data = load()
    data[key] = value
    persist(data)
  }
}
