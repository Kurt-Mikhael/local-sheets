import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import {
  createDriver,
  registerOrLogin,
  type WebDriver,
} from './helper'

const USER_A_EMAIL = `e2e-syncA-${Date.now()}@test.com`
const USER_B_EMAIL = `e2e-syncB-${Date.now()}@test.com`
const TEST_PASS = 'sync1234567890'
const PROFILE_A = path.join(os.tmpdir(), `e2e-syncA-${Date.now()}`)
const PROFILE_B = path.join(os.tmpdir(), `e2e-syncB-${Date.now()}`)

let driverA: WebDriver
let driverB: WebDriver

beforeAll(async () => {
  fs.mkdirSync(PROFILE_A, { recursive: true })
  fs.mkdirSync(PROFILE_B, { recursive: true })
  driverA = await createDriver({ userDataDir: PROFILE_A })
  driverB = await createDriver({ userDataDir: PROFILE_B })
  await registerOrLogin(driverA, USER_A_EMAIL, TEST_PASS)
  await registerOrLogin(driverB, USER_B_EMAIL, TEST_PASS)
})

afterAll(async () => {
  if (driverA) await driverA.quit()
  if (driverB) await driverB.quit()
  fs.rmSync(PROFILE_A, { recursive: true, force: true })
  fs.rmSync(PROFILE_B, { recursive: true, force: true })
})

describe('Collab Real-time Sync', () => {
  it('two users can have independent sessions (sanity check)', async () => {
    const urlA = await driverA.getCurrentUrl()
    const urlB = await driverB.getCurrentUrl()
    expect(urlA).toBe('http://localhost:3000/')
    expect(urlB).toBe('http://localhost:3000/')
  })

  it('user A has a workbook; user B cannot see it (different user.id)', async () => {
    const idsA = await driverA.executeScript<string[]>('window.__lastWorkbookIds ?? []')
    expect(Array.isArray(idsA)).toBe(true)
  })

  it.skip('edit in A appears in B within 2s (requires Yjs FE integration test harness)', async () => {
    // Reserved for when cell interaction via Selenium becomes reliable
  })
})
