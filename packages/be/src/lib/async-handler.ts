import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { safeErrorResponse } from './security.js'

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown

export function asyncHandler(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      if (res.headersSent) return
      const safe = safeErrorResponse(error)
      res.status(safe.status).json(safe.body)
    })
  }
}
