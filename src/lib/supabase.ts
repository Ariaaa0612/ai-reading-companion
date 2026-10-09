import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

// ===== 昵称登录（不依赖 Supabase Auth，用自定义 users 表） =====

const NICKNAME_KEY = 'arc_nickname'

/** 获取当前登录的昵称 */
export function getCurrentNickname(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(NICKNAME_KEY)
}

/** 昵称登录：检查是否已存在，不存在则创建 */
export async function loginWithNickname(nickname: string): Promise<{ success: boolean; error?: string }> {
  const trimmed = nickname.trim()
  if (!trimmed) {
    return { success: false, error: '请输入昵称' }
  }
  if (trimmed.length > 20) {
    return { success: false, error: '昵称不能超过 20 个字' }
  }

  try {
    // 查询是否已有此昵称
    const { data: existing } = await supabase
      .from('users')
      .select('id, nickname')
      .eq('nickname', trimmed)
      .maybeSingle()

    if (existing) {
      // 已存在，直接登录
      localStorage.setItem(NICKNAME_KEY, trimmed)
      localStorage.setItem('arc_user_id', existing.id)
      // 登录后静默合并云端数据到本地（恢复历史记录）
      try {
        const { syncAllFromCloud } = await import('./storage')
        await syncAllFromCloud()
      } catch (e) {
        console.warn('[login] syncAllFromCloud skipped (non-critical):', e)
      }
      return { success: true }
    }

    // 不存在，创建新用户
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({ nickname: trimmed })
      .select('id, nickname')
      .single()

    if (error || !newUser) {
      return { success: false, error: '登录失败，请重试' }
    }

    localStorage.setItem(NICKNAME_KEY, trimmed)
    localStorage.setItem('arc_user_id', newUser.id)
    // 新用户云端无数据，仍走一次同步以初始化本地（无副作用）
    try {
      const { syncAllFromCloud } = await import('./storage')
      await syncAllFromCloud()
    } catch (e) {
      console.warn('[login] syncAllFromCloud skipped (non-critical):', e)
    }
    return { success: true }
  } catch {
    return { success: false, error: '网络错误，请检查网络后重试' }
  }
}

/**
 * 退出登录：清除本机登录态与全部业务数据（云端记录按昵称保留，不受影响）
 * 注意：localStorage 业务数据不按用户隔离，必须一并清除，否则换号后会数据串扰
 */
export function logout(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(NICKNAME_KEY)
  localStorage.removeItem('arc_user_id')
  localStorage.removeItem('arc_user_plan')
  localStorage.removeItem('arc_reading_records')
  localStorage.removeItem('arc_quiz_answers')
  localStorage.removeItem('arc_chat_messages')
  localStorage.removeItem('arc_assessments')
  localStorage.removeItem('arc_weak_dimension')
}

/** 获取当前用户 ID（优先从 localStorage 取，兼容旧数据） */
export function getCurrentUserId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('arc_user_id')
}
