import express from 'express'
import { authRouter } from './routes/auth'
import { meRouter } from './routes/me'
import { syncRouter } from './routes/sync'

const app = express()
const PORT = Number(process.env.PORT ?? 4000)

app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ extended: false }))

app.use('/api/auth', authRouter)
app.use('/api/me', meRouter)
app.use('/api/sync', syncRouter)

app.listen(PORT, () => {
  console.log(`[be] Server running on http://localhost:${PORT}`)
})
