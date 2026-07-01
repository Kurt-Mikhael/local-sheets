import { Router } from 'express'
import { accountRepository } from '../repositories/account-repository.js'
import { HttpError } from '../lib/security.js'
import { asyncHandler } from '../lib/async-handler.js'
import { getCurrentUser } from '../lib/session.js'

export const sharedRouter = Router()

sharedRouter.get('/workbooks', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req)
  if (!user) throw new HttpError(401, 'Login diperlukan.')

  const ids = await accountRepository.listSharedWorkbookIds(user.id)
  res.json({ workbookIds: ids })
}))
