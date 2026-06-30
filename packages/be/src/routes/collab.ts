import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as map from 'lib0/map'
import * as cookie from 'cookie'
import { accountRepository } from '../repositories/account-repository.js'
import { createHash } from 'node:crypto'

const SESSION_COOKIE = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1'
  ? '__Host-localsheet_session'
  : 'localsheet_session'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

async function getUserFromCookie(req: IncomingMessage): Promise<{ id: string; email: string } | null> {
  const cookies = cookie.parse(req.headers.cookie ?? '')
  const token = cookies[SESSION_COOKIE]
  if (!token) {
    return null
  }
  try {
    const session = await accountRepository.findUserBySessionHash(hashToken(token))
    if (!session || session.expiresAt <= new Date()) {
      return null
    }
    return session.user
  } catch {
    return null
  }
}

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

const MAX_MESSAGE_BYTES = 256 * 1024
const MAX_MESSAGES_PER_WINDOW = 60
const WINDOW_MS = 10_000

interface ConnState {
  count: number
  resetAt: number
}
const connStates = new WeakMap<WebSocket, ConnState>()

function allowMessage(ws: WebSocket): boolean {
  const now = Date.now()
  let state = connStates.get(ws)
  if (!state || state.resetAt <= now) {
    state = { count: 1, resetAt: now + WINDOW_MS }
    connStates.set(ws, state)
    return true
  }
  if (state.count >= MAX_MESSAGES_PER_WINDOW) return false
  state.count += 1
  return true
}

interface Room {
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  conns: Map<WebSocket, Set<number>>
}

const rooms = new Map<string, Room>()

function getRoom(roomName: string): Room {
  return map.setIfUndefined(rooms, roomName, () => {
    const doc = new Y.Doc()
    const awareness = new awarenessProtocol.Awareness(doc)
    awareness.setLocalState(null)

    doc.on('update', (update, origin) => {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeUpdate(encoder, update)
      const message = encoding.toUint8Array(encoder)
      const room = rooms.get(roomName)
      if (!room) return
      for (const conn of room.conns.keys()) {
        if (conn !== origin && conn.readyState === WebSocket.OPEN) {
          conn.send(message)
        }
      }
    })

    awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changedClients = added.concat(updated, removed)
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients))
      const message = encoding.toUint8Array(encoder)
      const room = rooms.get(roomName)
      if (!room) return
      for (const conn of room.conns.keys()) {
        if (conn !== origin && conn.readyState === WebSocket.OPEN) {
          conn.send(message)
        }
      }
    })

    const room: Room = { doc, awareness, conns: new Map() }
    return room
  })
}

function sendSyncStep1(ws: WebSocket, room: Room): void {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeSyncStep1(encoder, room.doc)
  ws.send(encoding.toUint8Array(encoder))

  if (room.awareness.getStates().size > 0) {
    const aEncoder = encoding.createEncoder()
    encoding.writeVarUint(aEncoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(
      aEncoder,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(room.awareness.getStates().keys())),
    )
    ws.send(encoding.toUint8Array(aEncoder))
  }
}

function handleMessage(ws: WebSocket, room: Room, data: Uint8Array): void {
  if (data.byteLength > MAX_MESSAGE_BYTES) {
    ws.close(1009, 'Message too large')
    return
  }
  if (!allowMessage(ws)) {
    ws.close(1011, 'Rate limit exceeded')
    return
  }
  const decoder = decoding.createDecoder(data)
  const encoder = encoding.createEncoder()
  const messageType = decoding.readVarUint(decoder)
  switch (messageType) {
    case MESSAGE_SYNC: {
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws)
      if (encoding.length(encoder) > 1) {
        ws.send(encoding.toUint8Array(encoder))
      }
      break
    }
    case MESSAGE_AWARENESS: {
      awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), ws)
      break
    }
    default:
      ws.close(1003, 'Unknown message type')
  }
}

async function loadRoomFromDb(roomName: string, room: Room): Promise<void> {
  const [userId, workbookId] = roomName.split(':')
  if (!userId || !workbookId) return
  const row = await accountRepository.findSnapshot(userId, workbookId)
  if (!row) return
  const buf = new Uint8Array(row.doc)
  if (buf.byteLength < 2) return
  try {
    Y.applyUpdate(room.doc, buf)
  } catch (error) {
    console.error('[ws] failed to apply snapshot for room', error)
  }
}

async function saveRoomToDb(roomName: string, room: Room): Promise<void> {
  const [userId, workbookId] = roomName.split(':')
  if (!userId || !workbookId) return
  const state = Y.encodeStateAsUpdate(room.doc)
  const stateBuffer = Buffer.from(state)
  if (stateBuffer.length > 5 * 1024 * 1024) {
    console.warn('[ws] snapshot too large, skipping save')
    return
  }
  try {
    await accountRepository.upsertSnapshot(userId, workbookId, stateBuffer)
  } catch (error) {
    console.error('[ws] failed to save snapshot', error)
  }
}

const SAVE_INTERVAL_MS = 30_000
setInterval(() => {
  for (const [roomName, room] of rooms) {
    if (room.conns.size === 0) continue
    void saveRoomToDb(roomName, room).catch((err) => {
      console.error('[ws] periodic save failed', err)
    })
  }
}, SAVE_INTERVAL_MS)

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES })

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const roomName = (req.url ?? '/').slice(1).split('?')[0]
  if (!roomName) {
    ws.close()
    return
  }
  const room = getRoom(roomName)
  const controlledIds = new Set<number>()
  room.conns.set(ws, controlledIds)

  if (room.doc.store.clients.size === 0) {
    void loadRoomFromDb(roomName, room)
  }

  ws.binaryType = 'arraybuffer'
  ws.on('message', (data: Buffer) => {
    try {
      handleMessage(ws, room, new Uint8Array(data))
    } catch {
      ws.close(1011, 'Message handler error')
    }
  })

  ws.on('close', () => {
    const awareness = room.awareness
    awarenessProtocol.removeAwarenessStates(awareness, Array.from(controlledIds), null)
    room.conns.delete(ws)
    if (room.conns.size === 0) {
      void saveRoomToDb(roomName, room).catch((err) => {
        console.error('[ws] save on empty room failed', err)
      })
    }
  })

  sendSyncStep1(ws, room)
})

function rejectUpgrade(socket: Duplex, status: number, body: string): void {
  const payload = JSON.stringify({ error: body })
  socket.write(
    `HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : 'Bad Request'}\r\n` +
      'Content-Type: application/json\r\n' +
      `Content-Length: ${Buffer.byteLength(payload)}\r\n` +
      'Connection: close\r\n\r\n' +
      payload,
  )
  socket.destroy()
}

export function handleCollabUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  void (async () => {
    const user = await getUserFromCookie(req)
    if (!user) {
      rejectUpgrade(socket, 401, 'Login diperlukan untuk kolaborasi.')
      return
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const workbookId = url.pathname.split('/').filter(Boolean).pop() ?? ''
    if (!workbookId) {
      rejectUpgrade(socket, 400, 'Workbook id kosong.')
      return
    }

    const ownerRow = await accountRepository.findWorkbookOwner(workbookId)
    if (!ownerRow) {
      rejectUpgrade(socket, 404, 'Workbook tidak ditemukan.')
      return
    }
    if (ownerRow.ownerId !== user.id) {
      const granted = await accountRepository.userHasWorkbookAccess(user.id, workbookId)
      if (!granted) {
        rejectUpgrade(socket, 403, 'Anda tidak memiliki akses ke workbook ini.')
        return
      }
    }

    const roomName = `${ownerRow.ownerId}:${workbookId}`
    req.url = `/${roomName}`

    wss.handleUpgrade(req, socket as never, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })()
}
