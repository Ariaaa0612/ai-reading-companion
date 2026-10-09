'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getCurrentNickname } from '@/lib/supabase'

/**
 * 全局登录守卫（轻量版）
 *
 * 策略：不阻塞渲染，只做重定向副作用
 * - 未登录用户访问非 /login 页面 → 跳转 /login
 * - 已登录用户访问 /login → 跳转 /
 * - 页面内容正常渲染，重定向在后台发生
 *
 * 这样避免了 useEffect + useState 导致的永久 loading 问题
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (typeof window === 'undefined') return

    const nickname = getCurrentNickname()
    const currentPath = window.location.pathname
    const isLoginPage = currentPath === '/login'

    if (!nickname && !isLoginPage) {
      router.replace('/login')
    } else if (nickname && isLoginPage) {
      router.replace('/')
    }
  }, [router, pathname])

  return <>{children}</>
}
