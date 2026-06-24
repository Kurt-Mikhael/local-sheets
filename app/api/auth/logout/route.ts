import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { assertMutationRequest, safeErrorResponse } from '@/lib/server/security'
import { clearSession } from '@/lib/server/session'

export async function POST(request: NextRequest) {
  try {
    assertMutationRequest(request)
    const response = NextResponse.json({ ok: true })
    await clearSession(request, response)
    return response
  } catch (error) {
    const safe = safeErrorResponse(error)
    return NextResponse.json(safe.body, { status: safe.status })
  }
}
