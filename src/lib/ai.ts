/**
 * 统一 AI 调用层
 *
 * 功能：
 * - 封装 DeepSeek API 调用
 * - 超时控制（15 秒）
 * - 重试机制（1 次）
 * - JSON 输出校验
 * - 失败时返回 null，调用方走兜底逻辑
 *
 * 使用方式：
 *   import { callAI } from '@/lib/ai'
 *   const result = await callAI(systemPrompt, userMessage)
 *   if (!result) {
 *     // 走模板兜底
 *   }
 */

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ''
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'
const MODEL = 'deepseek-chat'
const TIMEOUT_MS = 15000
const MAX_RETRIES = 1

interface AIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface AIResponse {
  content: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/**
 * 调用 DeepSeek API
 *
 * @param systemPrompt - 系统提示词（角色定义、评分标准、输出格式等）
 * @param userMessage  - 用户消息（包含变量注入的上下文）
 * @returns AI 返回的文本内容，失败时返回 null
 */
export async function callAI(
  systemPrompt: string,
  userMessage: string
): Promise<string | null> {
  if (!DEEPSEEK_API_KEY) {
    console.error('[AI] DEEPSEEK_API_KEY not configured')
    return null
  }

  const messages: AIMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

      const res = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          // 降低 temperature 提高输出稳定性（评估类任务需要确定性）
          temperature: 0.5,
          max_tokens: 2000,
          stream: false,
          // 强制 JSON 输出格式，减少非 JSON 返回概率
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (!res.ok) {
        const errText = await res.text().catch(() => 'unknown error')
        console.error(`[AI] API error (attempt ${attempt + 1}):`, res.status, errText)
        if (attempt < MAX_RETRIES) continue
        return null
      }

      const data = await res.json()
      const content = data?.choices?.[0]?.message?.content

      if (!content || typeof content !== 'string') {
        console.error('[AI] Empty response content')
        if (attempt < MAX_RETRIES) continue
        return null
      }

      return content.trim()
    } catch (e) {
      const isAbort = e instanceof Error && e.name === 'AbortError'
      console.error(`[AI] ${isAbort ? 'Timeout' : 'Error'} (attempt ${attempt + 1}):`, e)
      if (attempt < MAX_RETRIES) continue
      return null
    }
  }

  return null
}

/**
 * 安全解析 JSON
 * 处理 AI 返回中可能包含的 markdown 代码块包裹
 *
 * @param raw - AI 返回的原始文本
 * @returns 解析后的对象，失败时返回 null
 */
export function safeParseJSON<T = unknown>(raw: string): T | null {
  if (!raw) return null

  let text = raw.trim()

  // 去除可能的 markdown 代码块包裹
  if (text.startsWith('```json')) {
    text = text.slice(7)
  } else if (text.startsWith('```')) {
    text = text.slice(3)
  }
  if (text.endsWith('```')) {
    text = text.slice(0, -3)
  }

  text = text.trim()

  try {
    return JSON.parse(text) as T
  } catch {
    // 尝试提取第一个 JSON 对象
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        return JSON.parse(match[0]) as T
      } catch {
        return null
      }
    }
    return null
  }
}

/**
 * 完整的 AI 调用 + JSON 解析一体化
 *
 * @param systemPrompt - 系统提示词
 * @param userMessage  - 用户消息
 * @returns 解析后的 JSON 对象，失败时返回 null
 */
export async function callAIForJSON<T = unknown>(
  systemPrompt: string,
  userMessage: string
): Promise<T | null> {
  const raw = await callAI(systemPrompt, userMessage)
  if (!raw) return null

  const parsed = safeParseJSON<T>(raw)
  if (!parsed) {
    console.error('[AI] JSON parse failed, raw content:', raw.slice(0, 200))
  }

  return parsed
}
