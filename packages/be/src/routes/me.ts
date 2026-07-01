import { Router } from 'express'
import { getCurrentUser } from '../lib/session.js'
import { asyncHandler } from '../lib/async-handler.js'

export const meRouter = Router()

meRouter.get('/', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req)
  if (!user) {
    res.status(401).json({ user: null })
    return
  }
  res.json({ user: { id: user.id, email: user.email, role: user.role } })
}))
