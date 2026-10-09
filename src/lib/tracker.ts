/**
 * 统一埋点工具
 *
 * 双通道追踪：
 * 1. Supabase events 表 —— 业务数据（评分、维度、阶段等）
 * 2. PostHog Cloud —— 宏观行为（PV、留存、会话回放）
 *
 * 使用方式：
 *   import { track } from '@/lib/tracker'
 *   track('question_answered', { dimension: '批判性思维', score: 8, stage: '成长期' })
 */

import { supabase, getCurrentNickname, getCurrentUserId } from '@/lib/supabase'

// PostHog 配置（需要用户注册 PostHog Cloud 后填入）
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || ''
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com'

/** PostHog 是否已配置 */
export function isPostHogEnabled(): boolean {
  return POSTHOG_KEY.length > 0
}

/** 动态加载 PostHog 脚本 */
export async function initPostHog(): Promise<void> {
  if (typeof window === 'undefined' || !isPostHogEnabled()) return

  // 避免重复加载
  if ((window as unknown as Record<string, unknown>).posthog) return

  try {
    const script = document.createElement('script')
    script.innerHTML = `
      !function(t,e){var o,n,i,r,a,c,s,u,l,p;function h(o,n){o[n]=function(){o._q=[n,...o._q||[]].concat([].slice.call(arguments,0))}}function f(t,e){try{t[e]=t[e]||function(){t._q=t._q||[],t._q.push([e].concat([].slice.call(arguments,0)))}}catch(o){}}t.posthog=e,e._q=[],e.init=function(o,n,i){var r=e;function a(t,e){t[e]=function(){r._q=[e,...r._q||[]].concat([].slice.call(arguments,0))}}for(var c=["init","capture","register","register_once","unregister","identify","reset","set_config","get_config","get_feature_flag","get_feature_flag_payload","get_property","has_opted_in_capturing","opt_in_capturing","opt_out_capturing","start_session_recording","stop_session_recording","session_recording_started","reload_feature_flags","debug","on"],s=0;s<c.length;s++)a(r,c[s]);r._i=o,r._config=n,r.__loaded=!0,i=t.__posthog_loaded||!1,t.__posthog_loaded=i,t.fetch&&(r.sessionRecording=t.sessionRecording||function(){var t=r,e=t._config,o=t._q||[];return{start:function(){o.push(["start_session_recording"].concat([].slice.call(arguments,0)))},stop:function(){o.push(["stop_session_recording"].concat([].slice.call(arguments,0)))},started:function(){return!1}}}),r.persistence=r.persistence||{register:function(){},unregister:function(){},get_property:function(){}},r._q.push(["init"].concat([o,n,i]))};for(var d=["capture","register","register_once","unregister","identify","reset","set_config","get_config","get_feature_flag","get_feature_flag_payload","get_property","has_opted_in_capturing","opt_in_capturing","opt_out_capturing","start_session_recording","stop_session_recording","session_recording_started","reload_feature_flags","debug","on"],g=0;g<d.length;g++)h(e,d[g]);o=navigator.userAgent.toLowerCase(),/msie|trident/.test(o)||/edge/.test(o)||(i=document.createElement("script"),i.type="text/javascript",i.crossOrigin="anonymous",i.src="${POSTHOG_HOST}/static/array.js",r=document.getElementsByTagName("script")[0],r.parentNode.insertBefore(i,r))}(window,window.posthog||[]);
      posthog.init('${POSTHOG_KEY}', { api_host: '${POSTHOG_HOST}' });
    `
    document.head.appendChild(script)
  } catch (e) {
    console.error('PostHog init error:', e)
  }
}

interface TrackProperties {
  [key: string]: string | number | boolean | null | undefined
}

/**
 * 统一埋点函数
 * MVP 阶段暂时禁用，避免代理/网络问题影响核心功能
 */
export async function track(
  _eventName: string,
  _properties: TrackProperties = {}
): Promise<void> {
  // 埋点暂时关闭
  return
}

/**
 * 识别用户（PostHog）
 * 在登录成功后调用
 */
export function identifyUser(userId: string, nickname: string): void {
  if (typeof window === 'undefined') return

  try {
    const posthog = (window as unknown as Record<string, unknown>).posthog as
      | { identify?: (id: string, props?: Record<string, unknown>) => void }
      | undefined
    if (posthog?.identify) {
      posthog.identify(userId, { nickname })
    }
  } catch {
    // PostHog 未加载，忽略
  }
}
