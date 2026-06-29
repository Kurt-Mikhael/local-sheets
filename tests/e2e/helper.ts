import { Builder, Browser, until, logging, type WebDriver, type Session } from 'selenium-webdriver'
import chrome from 'selenium-webdriver/chrome.js'
import { path as chromedriverPath } from 'chromedriver'

const BASE = 'http://localhost:3000'

export function createDriver(opts: { userDataDir?: string; headless?: boolean } = {}): WebDriver {
  const service = new chrome.ServiceBuilder(chromedriverPath)
  const options = new chrome.Options()
  options.addArguments('--no-sandbox')
  options.addArguments('--disable-dev-shm-usage')
  options.addArguments('--window-size=1280,720')
  if (opts.userDataDir) {
    options.addArguments(`--user-data-dir=${opts.userDataDir}`)
  }
  if (opts.headless) {
    options.addArguments('--headless=new')
  }
  options.setChromeBinaryPath('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')

  return new Builder()
    .forBrowser(Browser.CHROME)
    .setChromeService(service)
    .setChromeOptions(options)
    .build()
}

export function baseUrl(): string {
  return BASE
}

export async function registerOrLogin(
  driver: WebDriver,
  email: string,
  password: string,
): Promise<void> {
  await driver.get(`${BASE}/register`)
  const emailInput = await driver.findElement({ css: 'input[name="email"]' })
  const passInput = await driver.findElement({ css: 'input[name="password"]' })
  await emailInput.clear()
  await passInput.clear()
  await emailInput.sendKeys(email)
  await passInput.sendKeys(password)
  await driver.findElement({ css: 'button[type="submit"]' }).click()
  try {
    await driver.wait(until.urlIs(`${BASE}/`), 5000)
  } catch {
    const errEls = await driver.findElements({ css: '.form-error' })
    if (errEls.length) {
      const msg = await errEls[0].getText()
      throw new Error(`register failed: ${msg}`)
    }
    await driver.get(`${BASE}/login`)
    const emailInput2 = await driver.findElement({ css: 'input[name="email"]' })
    const passInput2 = await driver.findElement({ css: 'input[name="password"]' })
    await emailInput2.clear()
    await passInput2.clear()
    await emailInput2.sendKeys(email)
    await passInput2.sendKeys(password)
    await driver.findElement({ css: 'button[type="submit"]' }).click()
    await driver.wait(until.urlIs(`${BASE}/`), 5000)
  }
}

export async function logout(driver: WebDriver): Promise<void> {
  await driver.executeScript(`
    document.cookie = 'localsheet_session=; Path=/; Max-Age=0';
    document.cookie = '__Host-localsheet_session=; Path=/; Max-Age=0';
  `)
  await driver.manage().deleteAllCookies()
}

export async function getActiveWorkbookId(driver: WebDriver): Promise<string> {
  const id = await driver.executeScript<string | null>(`
    (() => {
      const els = document.querySelectorAll('.workbook-item')
      if (els.length === 0) return null
      const first = els[0]
      return first.getAttribute('data-workbook-id') ?? first.id ?? null
    })()
  `)
  if (!id) throw new Error('No active workbook found')
  return id
}

export async function waitForWorkbook(driver: WebDriver, timeoutMs = 8000): Promise<string> {
  await driver.wait(
    async () => {
      const els = await driver.findElements({ css: '.workbook-item[data-workbook-id]' })
      return els.length > 0
    },
    timeoutMs,
  )
  return await getActiveWorkbookId(driver)
}

export async function selectWorkbookByTitle(driver: WebDriver, title: string): Promise<void> {
  const item = await driver.findElement({
    xpath: `//button[contains(@class, "workbook-item")]//span[text()="${title}"]/..`,
  })
  await item.click()
}

export async function getCellValue(
  driver: WebDriver,
  row: number,
  col: number,
): Promise<string | null> {
  return driver.executeScript<string | null>(`
    (() => {
      const univer = document.querySelector('.univer-sheet-container');
      if (!univer) return null;
      const cells = univer.querySelectorAll('[data-u-comp="cell-content"]');
      const target = cells[${row} * 26 + ${col}];
      return target ? target.textContent?.trim() ?? null : null;
    })()
  `)
}

export async function typeIntoCell(
  driver: WebDriver,
  row: number,
  col: number,
  text: string,
): Promise<void> {
  await driver.executeScript(`
    (() => {
      const cells = document.querySelectorAll('[data-u-comp="cell-content"]');
      const target = cells[${row} * 26 + ${col}];
      if (target) {
        const evt = new MouseEvent('click', { bubbles: true });
        target.dispatchEvent(evt);
        target.click();
      }
    })()
  `)
  await driver.sleep(100)
  await driver.executeScript(`
    (() => {
      const evt = new KeyboardEvent('keydown', { key: '${text.length === 1 ? text : 'Enter'}', bubbles: true });
      document.activeElement?.dispatchEvent(evt);
    })()
  `)
}

export async function waitForCellValue(
  driver: WebDriver,
  row: number,
  col: number,
  expected: string,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const v = await getCellValue(driver, row, col)
    if (v === expected) return
    await driver.sleep(150)
  }
  throw new Error(
    `Cell (${row},${col}) did not become "${expected}" within ${timeoutMs}ms. ` +
    `Current: ${await getCellValue(driver, row, col)}`,
  )
}

export function getConsoleLogs(driver: WebDriver): logging.Entry[] {
  return []
}

export async function clearBrowserData(driver: WebDriver): Promise<void> {
  await driver.executeScript(`
    (async () => {
      const dbs = await indexedDB.databases?.() ?? []
      for (const d of dbs) {
        if (d.name) await new Promise((res) => {
          const req = indexedDB.deleteDatabase(d.name)
          req.onsuccess = req.onerror = req.onblocked = res
        })
      }
      localStorage.clear()
      sessionStorage.clear()
    })()
  `)
  await driver.manage().deleteAllCookies()
}

export type { WebDriver, Session }
