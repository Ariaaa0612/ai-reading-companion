import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * 登录 API（服务端）
 * POST /api/auth/login
 * Body: { nickname: string }
 *
 * 策略：优先尝试 Supabase，失败则降级为本地登录
 * 确保 Supabase RLS/网络问题不会阻断用户进入应用
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

/** 生成本地用户 ID（Supabase 不可用时的降级方案） */
function generateLocalUserId(nickname: string): string {
  const crypto = require('crypto')
  return `local-${crypto.createHash('sha256').update(nickname).digest('hex').slice(0, 16)}`
}

export async function POST(request: Request) {
  let nickname: string | null = null

  try {
    const body = await request.json()
    nickname = body.nickname?.trim()

    if (!nickname) {
      return NextResponse.json({ success: false, error: '请输入昵称' }, { status: 400 })
    }
    if (nickname.length > 20) {
      return NextResponse.json({ success: false, error: '昵称不能超过 20 个字' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // 查询是否已有此昵称
    const { data: existing, error: queryError } = await supabase
      .from('users')
      .select('id, nickname')
      .eq('nickname', nickname)
      .maybeSingle()

    if (queryError) {
      console.warn('Supabase query failed, using local login:', queryError.message)
      // 降级：返回本地生成的用户
      return NextResponse.json({
        success: true,
        user: { id: generateLocalUserId(nickname), nickname }
      })
    }

    if (existing) {
      // 已存在，返回用户信息
      return NextResponse.json({
        success: true,
        user: { id: existing.id, nickname: existing.nickname }
      })
    }

    // 不存在，创建新用户
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({ nickname })
      .select('id, nickname')
      .single()

    if (insertError || !newUser) {
      console.warn('Supabase insert failed, using local login:', insertError?.message)
      // 降级：返回本地生成的用户
      return NextResponse.json({
        success: true,
        user: { id: generateLocalUserId(nickname), nickname }
      })
    }

    return NextResponse.json({
      success: true,
      user: { id: newUser.id, nickname: newUser.nickname }
    })
  } catch (e) {
    console.error('Login API error:', e)
    // 最终降级：如果已解析出 nickname，生成本地用户
    if (nickname) {
      return NextResponse.json({
        success: true,
        user: { id: generateLocalUserId(nickname), nickname }
      })
    }
    return NextResponse.json({ success: false, error: '服务器错误，请重试' }, { status: 500 })
  }
}
