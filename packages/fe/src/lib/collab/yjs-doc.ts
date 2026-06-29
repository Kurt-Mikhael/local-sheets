import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'

interface Room {
  doc: Y.Doc
  indexeddb: IndexeddbPersistence
  websocket: WebsocketProvider | null
  refCount: number
}

const rooms = new Map<string, Room>()
const awarenessStates = new Map<string, Set<number>>()

export interface CollabUser {
  id: string
  email: string
  color: string
}

export interface JoinResult {
  doc: Y.Doc
  cells: Y.Map<Y.Map<unknown>>
  presence: Y.Map<unknown>
  websocket: WebsocketProvider | null
  indexeddb: IndexeddbPersistence
}

const PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#a855f7', '#ec4899',
]

function colorFor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/api/collab`
}

export async function joinWorkbook(
  workbookId: string,
  user: CollabUser,
): Promise<JoinResult> {
  const existing = rooms.get(workbookId)
  if (existing) {
    existing.refCount += 1
    return finalize(existing, user)
  }

  const doc = new Y.Doc()
  const cells = doc.getMap<Y.Map<unknown>>('cells')
  const presence = doc.getMap<unknown>('presence')

  const indexeddb = new IndexeddbPersistence(`workbook-${workbookId}`, doc)
  await indexeddb.whenSynced

  let websocket: WebsocketProvider | null = null
  try {
    websocket = new WebsocketProvider(wsUrl(), workbookId, doc, {
      params: { uid: user.id },
      connect: true,
    })
    websocket.awareness.setLocalStateField('user', {
      id: user.id,
      email: user.email,
      color: colorFor(user.id),
    })
    const set = awarenessStates.get(workbookId) ?? new Set<number>()
    set.add(websocket.awareness.clientID)
    awarenessStates.set(workbookId, set)
  } catch {
    websocket = null
  }

  const room: Room = { doc, indexeddb, websocket, refCount: 1 }
  rooms.set(workbookId, room)
  return finalize(room, user)
}

function finalize(room: Room, _user: CollabUser): JoinResult {
  return {
    doc: room.doc,
    cells: room.doc.getMap<Y.Map<unknown>>('cells'),
    presence: room.doc.getMap<unknown>('presence'),
    websocket: room.websocket,
    indexeddb: room.indexeddb,
  }
}

export function leaveWorkbook(workbookId: string): void {
  const room = rooms.get(workbookId)
  if (!room) return
  room.refCount -= 1
  if (room.refCount > 0) return

  if (room.websocket) {
    const set = awarenessStates.get(workbookId)
    if (set) {
      set.delete(room.websocket.awareness.clientID)
      if (set.size === 0) awarenessStates.delete(workbookId)
    }
    room.websocket.disconnect()
    room.websocket.destroy()
  }
  room.indexeddb.destroy()
  room.doc.destroy()
  rooms.delete(workbookId)
}
