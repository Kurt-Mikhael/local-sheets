import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import {
  createDriver,
  registerOrLogin,
  waitForWorkbook,
  clearBrowserData,
  type WebDriver,
} from './helper'

const TEST_EMAIL = `e2e-smoke-${Date.now()}@test.com`
const TEST_PASS = 'smoke1234567890'
const PROFILE = path.join(os.tmpdir(), `e2e-smoke-${Date.now()}`)

let driver: WebDriver

beforeAll(async () => {
  fs.mkdirSync(PROFILE, { recursive: true })
  driver = await createDriver({ userDataDir: PROFILE })
  await registerOrLogin(driver, TEST_EMAIL, TEST_PASS)
})

afterAll(async () => {
  if (driver) await driver.quit()
  fs.rmSync(PROFILE, { recursive: true, force: true })
})

describe('Collab Smoke', () => {
  it('home page loads with workbook list', async () => {
    const url = await driver.getCurrentUrl()
    expect(url).toBe('http://localhost:3000/')
  })

  it('a workbook is created in IndexedDB on first visit', async () => {
    const id = await waitForWorkbook(driver, 5000)
    expect(id).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('clearing browser data and re-login creates a new workbook', async () => {
    await clearBrowserData(driver)
    await driver.get('http://localhost:3000/')
    const newId = await waitForWorkbook(driver, 5000)
    expect(newId).toMatch(/^[0-9a-f-]{36}$/i)
  })
})
