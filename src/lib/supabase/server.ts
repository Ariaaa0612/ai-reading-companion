import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/** 服务端 Supabase 客户端：沿用请求里的用户会话，RLS 依旧生效 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component 中无法写 cookie，由 proxy 负责刷新，忽略即可
          }
        },
      },
    }
  )
}
