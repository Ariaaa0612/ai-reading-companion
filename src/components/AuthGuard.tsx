'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * 全局登录守卫
 *
 * 以 Supabase 会话为准（localStorage 里的昵称不作为身份凭证）。
 * - 无会话访问非 /login 页面 → 跳转 /login
 * - 有会话访问 /login → 跳转 /
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    let cancelled = false

    async function check() {
      const supabase = getSupabaseClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (cancelled) return

      const isLoginPage = window.location.pathname === '/login'

      if (!session && !isLoginPage) {
        router.replace('/login')
      } else if (session && isLoginPage) {
        router.replace('/')
      }
    }

    void check()

    return () => {
      cancelled = true
    }
  }, [router, pathname])

  return <>{children}</>
}
