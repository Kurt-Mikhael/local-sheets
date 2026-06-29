import { Builder, By } from 'selenium-webdriver'
import chrome from 'selenium-webdriver/chrome.js'
import { path as chromedriverPath } from 'chromedriver'

const service = new chrome.ServiceBuilder(chromedriverPath)
const driver = await new Builder()
  .forBrowser('chrome')
  .setChromeService(service)
  .build()

await driver.get('http://localhost:3000/register')
const email = `dbg-${Date.now()}@test.com`
await driver.findElement(By.css('input[name="email"]')).sendKeys(email)
await driver.findElement(By.css('input[name="password"]')).sendKeys('dbg1234567890')
await driver.findElement(By.css('button[type="submit"]')).click()
await driver.sleep(3000)

const url = await driver.getCurrentUrl()
console.log('URL after register:', url)

const html = await driver.findElement(By.css('.workbook-list, main, body')).getAttribute('outerHTML').catch(() => 'n/a')
console.log('HTML snippet:', html.slice(0, 1500))

const items = await driver.findElements(By.css('.workbook-item'))
console.log('workbook-item count:', items.length)
for (const it of items) {
  const id = await it.getAttribute('data-workbook-id')
  const cls = await it.getAttribute('class')
  console.log('  - id:', id, 'class:', cls)
}

await driver.quit()
