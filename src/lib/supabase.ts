import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

let client: SupabaseClient | null = null

/** 浏览器端 Supabase 客户端（带登录态，会话存在 cookie 里，刷新不掉登录） */
export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    client = createBrowserClient(supabaseUrl, supabaseKey)
  }
  return client
}

// ===== 昵称 + 密码登录（底层使用 Supabase Auth） =====
// 昵称不适合做邮箱，因此把昵称哈希成一个固定的内部邮箱，用户全程不用看到它。

const NICKNAME_KEY = 'arc_nickname'
const USER_ID_KEY = 'arc_user_id'

/** 获取当前登录的昵称（仅用于界面展示，不作为身份凭证） */
export function getCurrentNickname(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(NICKNAME_KEY)
}

/** 获取当前用户 ID（由登录成功后写入，必须等于 auth.uid()） */
export function getCurrentUserId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(USER_ID_KEY)
}

/** 昵称 → 固定内部邮箱（同一个昵称永远得到同一个邮箱） */
async function nicknameToEmail(nickname: string): Promise<string> {
  const bytes = new TextEncoder().encode(nickname.trim().toLowerCase())
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `u_${hex.slice(0, 24)}@arc-reader.app`
}

/**
 * 昵称 + 密码登录：已存在则登录，不存在则自动注册。
 * 返回的 userId 与 Supabase Auth 的 auth.uid() 一致，RLS 依此校验权限。
 */
export async function loginWithNickname(
  nickname: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  const trimmed = nickname.trim()
  if (!trimmed) return { success: false, error: '请输入昵称' }
  if (trimmed.length > 20) return { success: false, error: '昵称不能超过 20 个字' }
  if (password.length < 6) return { success: false, error: '密码至少 6 位' }

  const supabase = getSupabaseClient()
  const email = await nicknameToEmail(trimmed)

  try {
    // 1) 先尝试登录
    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword({ email, password })

    let userId: string | null = signInData?.user?.id ?? null

    if (signInError) {
      if (!/invalid login credentials/i.test(signInError.message)) {
        return { success: false, error: signInError.message }
      }

      // 2) 登录失败 → 尝试注册（昵称首次使用时）
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      })

      if (signUpError) {
        if (/already registered|already exists/i.test(signUpError.message)) {
          return { success: false, error: '密码不正确' }
        }
        return { success: false, error: signUpError.message }
      }

      if (!signUpData.session) {
        return {
          success: false,
          error: '注册成功但需要邮箱验证，请在 Supabase 关闭「Confirm email」后重试',
        }
      }

      userId = signUpData.user?.id ?? null
    }

    if (!userId) return { success: false, error: '登录失败，请重试' }

    // 3) 同步昵称到用户资料表（RLS 只允许写自己这一行）
    const { error: profileError } = await supabase
      .from('users')
      .upsert({ id: userId, nickname: trimmed }, { onConflict: 'id' })

    if (profileError) {
      if (/duplicate key|unique/i.test(profileError.message)) {
        return { success: false, error: '该昵称已被使用' }
      }
      return { success: false, error: `保存用户信息失败：${profileError.message}` }
    }

    localStorage.setItem(NICKNAME_KEY, trimmed)
    localStorage.setItem(USER_ID_KEY, userId)

    // 登录后静默拉取云端历史数据
    try {
      const { syncAllFromCloud } = await import('./storage')
      await syncAllFromCloud()
    } catch (e) {
      console.warn('[login] syncAllFromCloud skipped (non-critical):', e)
    }

    return { success: true }
  } catch (e) {
    console.error('[login] error:', e)
    return { success: false, error: '网络错误，请检查网络后重试' }
  }
}

/**
 * 退出登录：清除本机登录态与全部业务数据（云端记录按账号保留，不受影响）
 */
export async function logout(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    await getSupabaseClient().auth.signOut()
  } catch (e) {
    console.warn('[logout] signOut failed (non-critical):', e)
  }

  localStorage.removeItem(NICKNAME_KEY)
  localStorage.removeItem(USER_ID_KEY)
  localStorage.removeItem('arc_user_plan')
  localStorage.removeItem('arc_reading_records')
  localStorage.removeItem('arc_quiz_answers')
  localStorage.removeItem('arc_chat_messages')
  localStorage.removeItem('arc_assessments')
  localStorage.removeItem('arc_weak_dimension')
}
