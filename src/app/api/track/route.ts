import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * 埋点 API（服务端）
 * POST /api/track
 * Body: { event: string, properties?: Record<string, unknown> }
 *
 * 服务端用 service role key 调 Supabase，绕过浏览器端 RLS 限制
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const eventName = body.event
    const properties = body.properties ?? {}
    const nickname = body.nickname ?? null
    const userId = body.userId ?? null

    if (!eventName) {
      return NextResponse.json(
        { success: false, error: 'event name required' },
        { status: 400 }
      )
    }

    // 服务端创建 client，不走浏览器 session
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { error } = await supabase.from('events').insert({
      user_id: userId,
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
