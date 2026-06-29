import { Router } from 'express'
import { accountRepository } from '../repositories/account-repository.js'
import { HttpError, safeErrorResponse } from '../lib/security.js'
import { getCurrentUser } from '../lib/session.js'

export const sharedRouter = Router()

sharedRouter.get('/workbooks', async (req, res) => {
  try {
    const user = await getCurrentUser(req)
    if (!user) throw new HttpError(401, 'Login diperlukan.')

    const ids = await accountRepository.listSharedWorkbookIds(user.id)
    res.json({ workbookIds: ids })
  } catch (error) {
    if (res.headersSent) return
    const safe = safeErrorResponse(error)
    res.status(safe.status).json(safe.body)
  }
})
