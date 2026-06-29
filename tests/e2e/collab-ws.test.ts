import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WebSocket } from 'ws'
import { WebsocketProvider } from 'y-websocket'
import { randomUUID } from 'node:crypto'
import * as Y from 'yjs'
import { Client } from 'pg'

const BASE_HTTP = 'http://localhost:3000'
const BASE_WS = 'ws://localhost:3000/api/collab'

interface Session {
  cookie: string
  userId: string
  email: string
}

async function createUser(email: string, password: string): Promise<Session> {
  const res = await fetch(`${BASE_HTTP}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'offline-spreadsheet',
      'Origin': BASE_HTTP,
    },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    throw new Error(`register failed: ${res.status} ${await res.text()}`)
  }
  const setCookie = res.headers.get('set-cookie') ?? ''
  const cookie = setCookie.split(';')[0]
  const body = await res.json() as { user: { id: string; email: string } }
  return { cookie, userId: body.user.id, email: body.email }
}

function connectProvider(session: Session, workbookId: string): { provider: WebsocketProvider; doc: Y.Doc; cells: Y.Map<Y.Map<unknown>> } {
  const doc = new Y.Doc()
  const cells = doc.getMap<Y.Map<unknown>>('cells')
  const provider = new WebsocketProvider(BASE_WS, workbookId, doc, {
    params: { uid: session.userId },
    connect: true,
    WebSocketPolyfill: WebSocket as never,
    headers: { Cookie: session.cookie },
  } as never)
  return { provider, doc, cells }
}

function waitForSynced(provider: WebsocketProvider, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (provider.synced) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      provider.off('sync', onSync)
      reject(new Error('WS sync timeout'))
    }, timeoutMs)
    const onSync = (synced: boolean) => {
      if (synced) {
        clearTimeout(timer)
        provider.off('sync', onSync)
        resolve()
      }
    }
    provider.on('sync', onSync)
  })
}

describe('Collab WebSocket Protocol', () => {
  let sessionA: Session
  let sessionB: Session
  let workbookId: string

  beforeAll(async () => {
    const ts = Date.now()
    sessionA = await createUser(`e2e-wsA-${ts}@test.com`, 'wsa1234567890')
    sessionB = await createUser(`e2e-wsB-${ts}@test.com`, 'wsb1234567890')
    workbookId = randomUUID()
  })

  afterAll(async () => {
    const pg = new Client({ connectionString: process.env.DATABASE_URL })
    await pg.connect()
    await pg.query('DELETE FROM workbook_snapshots WHERE workbook_id = $1', [workbookId])
    await pg.end()
  })

  it('rejects unauthenticated WebSocket connection', async () => {
    const doc = new Y.Doc()
    const provider = new WebsocketProvider(BASE_WS, workbookId, doc, {
      connect: true,
      WebSocketPolyfill: WebSocket as never,
    } as never)
    const result = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(provider.wsconnected), 3000)
      provider.once('status', (e: { status: string }) => {
        if (e.status === 'connected') {
          clearTimeout(timer)
          resolve(true)
        }
        if (e.status === 'disconnected') {
          clearTimeout(timer)
          resolve(false)
        }
      })
    })
    expect(result).toBe(false)
    provider.destroy()
    doc.destroy()
  })

  it('user A and B can connect to the same workbook room', async () => {
    const A = connectProvider(sessionA, workbookId)
    const B = connectProvider(sessionB, workbookId)
    await waitForSynced(A.provider)
    await waitForSynced(B.provider)
    A.provider.destroy()
    B.provider.destroy()
    A.doc.destroy()
    B.doc.destroy()
  })

  it('cell change in A propagates to B', async () => {
    const A = connectProvider(sessionA, workbookId)
    const B = connectProvider(sessionB, workbookId)
    await waitForSynced(A.provider)
    await waitForSynced(B.provider)

    const sheetId = randomUUID()
    const key = `${sheetId}::0::0`

    A.doc.transact(() => {
      const cellMap = new Y.Map<unknown>()
      cellMap.set('v', 'Hello from A')
      A.cells.set(key, cellMap)
    })

    await new Promise((r) => setTimeout(r, 500))

    const received = B.cells.get(key)
    expect(received).toBeDefined()
    expect(received?.get('v')).toBe('Hello from A')

    A.provider.destroy()
    B.provider.destroy()
    A.doc.destroy()
    B.doc.destroy()
  })

  it('last-write-wins for same cell from both users (no crash)', async () => {
    const A = connectProvider(sessionA, workbookId)
    const B = connectProvider(sessionB, workbookId)
    await waitForSynced(A.provider)
    await waitForSynced(B.provider)

    const sheetId = randomUUID()
    const key = `${sheetId}::1::1`

    A.doc.transact(() => {
      const cellMap = new Y.Map<unknown>()
      cellMap.set('v', 'A wins')
      A.cells.set(key, cellMap)
    })
    B.doc.transact(() => {
      const cellMap = new Y.Map<unknown>()
      cellMap.set('v', 'B wins')
      B.cells.set(key, cellMap)
    })

    await new Promise((r) => setTimeout(r, 1000))

    const finalA = A.cells.get(key)?.get('v')
    const finalB = B.cells.get(key)?.get('v')
    expect(finalA).toBe(finalB)
    expect(['A wins', 'B wins']).toContain(finalA)

    A.provider.destroy()
    B.provider.destroy()
    A.doc.destroy()
    B.doc.destroy()
  })
})
