'use client'

import { useEffect, useRef } from 'react'
import { initPostHog, isPostHogEnabled, track, identifyUser } from '@/lib/tracker'
import { getCurrentNickname, getCurrentUserId } from '@/lib/supabase'

/**
 * PostHog 初始化组件
 * 在应用启动时加载 PostHog 脚本并发送 app_open 事件
 */
export function PostHogInit() {
  const initedRef = useRef(false)

  useEffect(() => {
    if (initedRef.current) return
    initedRef.current = true

    // 初始化 PostHog（如果已配置）
    if (isPostHogEnabled()) {
      initPostHog()
    }

    // 发送 app_open 事件（无论 PostHog 是否配置，都写入 Supabase）
    const nickname = getCurrentNickname()
    if (nickname) {
      const userId = getCurrentUserId()
      if (userId) {
        identifyUser(userId, nickname)
      }
      track('app_open', { nickname })
    }
  }, [])

  return null
}
