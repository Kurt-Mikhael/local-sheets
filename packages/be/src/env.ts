import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function findEnv(): string | null {
  const candidates = [
    resolve(here, '..', '..', '..', '.env'),
    resolve(here, '..', '..', '..', '..', '.env'),
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '..', '.env'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

const envPath = findEnv()
if (envPath) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}
