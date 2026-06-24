import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/server/session'

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request)
  if (!user) return NextResponse.json({ user: null }, { status: 401 })
  return NextResponse.json({ user })
}
