import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * 埋点 API（服务端）
 * POST /api/track
 * Body: { event: string, properties?: Record<string, unknown> }
 *
 * 使用请求里的用户会话写 events 表，RLS 保证只能写自己的记录。
 */

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const eventName = body.event
    const properties = body.properties ?? {}
    const nickname = body.nickname ?? null

    if (!eventName) {
      return NextResponse.json(
        { success: false, error: 'event name required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'unauthorized' },
        { status: 401 }
      )
    }

    const { error } = await supabase.from('events').insert({
      user_id: user.id,
      nickname,
      event_name: eventName,
      event_properties: properties,
    })

    if (error) {
      console.error('[api/track] supabase error:', error.message)
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[api/track] error:', e)
    return NextResponse.json(
      { success: false, error: 'track failed' },
      { status: 500 }
    )
  }
}
