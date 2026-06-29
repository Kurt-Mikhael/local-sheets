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
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`)
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]
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

describe('Collab Reconnect & Persistence', () => {
  let session: Session
  let workbookId: string
  const cleanupIds: string[] = []

  beforeAll(async () => {
    const ts = Date.now()
    session = await createUser(`e2e-persist-${ts}@test.com`, 'persist1234567890')
    workbookId = randomUUID()
    cleanupIds.push(workbookId)
  })

  afterAll(async () => {
    const pg = new Client({ connectionString: process.env.DATABASE_URL })
    await pg.connect()
    for (const id of cleanupIds) {
      await pg.query('DELETE FROM workbook_snapshots WHERE workbook_id = $1', [id])
    }
    await pg.end()
  })

  it('reconnect after disconnect: WS resyncs state', async () => {
    const A = connectProvider(session, workbookId)
    await waitForSynced(A.provider)

    const sheetId = randomUUID()
    const key = `${sheetId}::2::2`
    A.doc.transact(() => {
      const cellMap = new Y.Map<unknown>()
      cellMap.set('v', 'before-disconnect')
      A.cells.set(key, cellMap)
    })
    await new Promise((r) => setTimeout(r, 500))
    A.provider.destroy()
    A.doc.destroy()

    const B = connectProvider(session, workbookId)
    await waitForSynced(B.provider)
    await new Promise((r) => setTimeout(r, 500))

    const received = B.cells.get(key)
    expect(received?.get('v')).toBe('before-disconnect')
    B.provider.destroy()
    B.doc.destroy()
  })

  it('persists to Postgres after snapshot save (manual trigger via WS close + sleep)', async () => {
    const A = connectProvider(session, workbookId)
    await waitForSynced(A.provider)

    const sheetId = randomUUID()
    const key = `${sheetId}::3::3`
    A.doc.transact(() => {
      const cellMap = new Y.Map<unknown>()
      cellMap.set('v', 'persisted-value')
      A.cells.set(key, cellMap)
    })
    await new Promise((r) => setTimeout(r, 500))
    A.provider.destroy()
    A.doc.destroy()
    await new Promise((r) => setTimeout(r, 35_000))

    const pg = new Client({ connectionString: process.env.DATABASE_URL })
    await pg.connect()
    const result = await pg.query<{ doc: Buffer }>(
      'SELECT doc FROM workbook_snapshots WHERE user_id = $1 AND workbook_id = $2',
      [session.userId, workbookId],
    )
    await pg.end()

    expect(result.rows.length).toBe(1)
    const persisted = new Y.Doc()
    Y.applyUpdate(persisted, new Uint8Array(result.rows[0].doc))
    const cellMap = persisted.getMap<Y.Map<unknown>>('cells').get(key)
    expect(cellMap?.get('v')).toBe('persisted-value')
  })
})
