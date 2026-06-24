import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Builder, By, until } from 'selenium-webdriver'
import type { WebDriver } from 'selenium-webdriver'

const BASE = 'http://localhost:3000'
const TEST_EMAIL = `e2e-${Date.now()}@test.com`
const TEST_PASS = 'test1234567890'

let driver: WebDriver

beforeAll(async () => {
  driver = await new Builder().forBrowser('chrome').build()
  await driver.manage().window().setRect({ width: 1280, height: 720 })
})

afterAll(async () => {
  if (driver) await driver.quit()
})

describe('Auth Flow', () => {
  it('halaman utama dimuat dengan benar', async () => {
    await driver.get(BASE)
    const title = await driver.getTitle()
    expect(title).toContain('LocalSheet')
  })

  it('register akun baru', async () => {
    await driver.get(`${BASE}/register`)

    const emailInput = await driver.wait(until.elementLocated(By.css('input[name="email"]')), 5_000)
    const passInput = await driver.findElement(By.css('input[name="password"]'))

    await emailInput.sendKeys(TEST_EMAIL)
    await passInput.sendKeys(TEST_PASS)

    await driver.findElement(By.css('button[type="submit"]')).click()

    await driver.wait(until.urlIs(`${BASE}/`), 5_000)
    expect(await driver.getCurrentUrl()).toBe(`${BASE}/`)
  })

  it('logout dan login ulang', async () => {
    await driver.get(`${BASE}/login`)

    const emailInput = await driver.wait(until.elementLocated(By.css('input[name="email"]')), 5_000)
    const passInput = await driver.findElement(By.css('input[name="password"]'))

    await emailInput.sendKeys(TEST_EMAIL)
    await passInput.sendKeys(TEST_PASS)

    await driver.findElement(By.css('button[type="submit"]')).click()

    await driver.wait(until.urlIs(`${BASE}/`), 5_000)
    expect(await driver.getCurrentUrl()).toBe(`${BASE}/`)
  })

  it('login gagal dengan password salah', async () => {
    await driver.get(`${BASE}/login`)

    await driver.findElement(By.css('input[name="email"]')).sendKeys(TEST_EMAIL)
    await driver.findElement(By.css('input[name="password"]')).sendKeys('wrongpassword123')

    await driver.findElement(By.css('button[type="submit"]')).click()

    const errorEl = await driver.wait(until.elementLocated(By.css('.form-error')), 5_000)
    const errorText = await errorEl.getText()
    expect(errorText).toContain('Email atau password salah')
  })
})
