import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'

interface Room {
  doc: Y.Doc
  cells: Y.Map<Y.Map<unknown>>
  presence: Y.Map<unknown>
  indexeddb: IndexeddbPersistence
  websocket: WebsocketProvider | null
  refCount: number
}

const rooms = new Map<string, Room>()

export interface CollabUser {
  id: string
  email: string
  color: string
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

let cachedToken: { value: string; expires: number } | null = null
async function getWsToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value
  const res = await fetch('/api/auth/ws-token', { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`ws-token failed: ${res.status}`)
  const data = (await res.json()) as { token: string }
  cachedToken = { value: data.token, expires: Date.now() + 10 * 60 * 1000 }
  return data.token
}

export async function joinWorkbook(
  workbookId: string,
  user: CollabUser,
): Promise<{ doc: Y.Doc; cells: Y.Map<Y.Map<unknown>>; presence: Y.Map<unknown>; websocket: WebsocketProvider | null; indexeddb: IndexeddbPersistence }> {
  const existing = rooms.get(workbookId)
  if (existing) {
    existing.refCount += 1
    console.debug('[collab] joinWorkbook reuse', workbookId, 'refcount=', existing.refCount)
    return existing
  }
  console.debug('[collab] joinWorkbook new', workbookId)

  const doc = new Y.Doc()
  const cells = doc.getMap<Y.Map<unknown>>('cells')
  const presence = doc.getMap<unknown>('presence')
  const indexeddb = new IndexeddbPersistence(`workbook-${workbookId}`, doc)

  let websocket: WebsocketProvider | null = null
  try {
    const token = await getWsToken()
    websocket = new WebsocketProvider(wsUrl(), workbookId, doc, {
      connect: true,
      params: { uid: user.id, token },
    })
    websocket.on('status', (event: { status: string }) => {
      console.debug('[collab] ws status', workbookId, event.status)
    })
    websocket.on('connection-error', (err: unknown) => {
      console.warn('[collab] ws connection-error', workbookId, err)
    })
    websocket.on('sync', (synced: boolean) => {
      console.debug('[collab] ws sync', workbookId, 'synced=', synced)
    })
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      console.debug('[collab] doc update', workbookId, 'bytes=', update.byteLength, 'origin=', origin === websocket ? 'ws' : origin === doc ? 'self' : 'other')
    })
    websocket.awareness.setLocalStateField('user', {
      id: user.id,
      email: user.email,
      color: colorFor(user.id),
    })
  } catch (err) {
    console.warn('[collab] ws init failed', workbookId, err)
    websocket = null
  }

  const room: Room = { doc, cells, presence, indexeddb, websocket, refCount: 1 }
  rooms.set(workbookId, room)
  void indexeddb.whenSynced
  return room
}

export function leaveWorkbook(workbookId: string): void {
  const room = rooms.get(workbookId)
  if (!room) return
  room.refCount -= 1
  if (room.refCount > 0) return

  if (room.websocket) {
    room.websocket.disconnect()
    room.websocket.destroy()
  }
  room.indexeddb.destroy()
  room.doc.destroy()
  rooms.delete(workbookId)
}
