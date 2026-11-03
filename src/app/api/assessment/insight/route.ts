import { callAI, safeParseJSON } from '@/lib/ai'

/**
 * 测评综合解读接口
 *
 * 输入：客户端聚合后的跨天数据（不含原文、不含身份信息）
 * 输出：{ summary, trend, advice } —— AI 不可用时返回 { ai: false }，前端走模板兜底
 */

interface InsightRequest {
  dayCount?: number
  daily?: Array<{
    date?: string
    avg?: number
    answerCount?: number
    dimensions?: Record<string, number>
  }>
  weightedScores?: Array<{ dimension?: string; score?: number }>
  trend?: {
    latestAvg?: number | null
    previousAvg?: number | null
    delta?: number | null
    direction?: 'up' | 'down' | 'flat' | null
  }
}

interface InsightResult {
  summary: string
  trend: string
  advice: string[]
}

const SYSTEM_PROMPT = `你是一位阅读思维教练，面向普通读者（不是专业研究者）做阅读能力测评解读。

你会收到用户多天的作答统计数据：每天的五个维度得分与整体均分、加权后各维度得分、以及最近一天相较前一天的变化。

请输出严格的 JSON：
{
  "summary": "150~260 字的中文综合评语",
  "trend": "20~40 字的中文，一句话点出跨天变化的核心特征",
  "advice": ["建议1（30~50字，可当天执行）", "建议2（30~50字，可当天执行）"]
}

写作要求：
1. 必须体现"跨天"：明确指出哪一天比哪一天变化在哪，趋势是上升、回落还是平台期。
2. 数据要落到具体维度和分数上，例如"理解力从 5.8 升到 7.0"，不要只说"有所提升"。
3. 语言平实、像人话，不要空话套话，不要用"赋能""维度飞跃"这类词。
4. 只有 1 天数据时，不要编造对比，改写为"当前基线 + 下一步重点"。
5. advice 必须具体到能立刻做的动作，不要"多读书""多练习"这种。
6. 不要评价用户人格，只评价这次的表现与变化。
7. 只输出 JSON，不要 markdown 代码块，不要任何解释文字。`

function fallbackText(lines: string[], limit: number): string {
  return lines.join('，').slice(0, limit)
}

export async function POST(request: Request) {
  let body: InsightRequest
  try {
    body = (await request.json()) as InsightRequest
  } catch {
    return Response.json({ ai: false, error: '请求体解析失败' }, { status: 400 })
  }

  const daily = Array.isArray(body.daily) ? body.daily : []
  const weighted = Array.isArray(body.weightedScores) ? body.weightedScores : []

  // 没有作答数据时不浪费一次 AI 调用
  if (daily.length === 0 && weighted.length === 0) {
    return Response.json({ ai: false, error: '暂无作答数据' }, { status: 400 })
  }

  const userMessage = JSON.stringify(
    {
      作答天数: body.dayCount ?? daily.length,
      每日表现: daily,
      加权维度得分: weighted,
      最近变化: body.trend ?? {},
    },
    null,
    2
  )

  const raw = await callAI(SYSTEM_PROMPT, userMessage)
  if (!raw) {
    return Response.json({ ai: false })
  }

  const parsed = safeParseJSON<Partial<InsightResult>>(raw)
  if (!parsed) {
    return Response.json({ ai: false })
  }

  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim().length >= 30
      ? parsed.summary.trim()
      : ''
  const trend = typeof parsed.trend === 'string' ? parsed.trend.trim() : ''
  const advice = Array.isArray(parsed.advice)
    ? parsed.advice.filter((a): a is string => typeof a === 'string' && a.trim().length > 0).slice(0, 3)
    : []

  if (!summary && !trend && advice.length === 0) {
    return Response.json({ ai: false })
  }

  const result: InsightResult & { ai: true } = {
    ai: true,
    summary: summary || fallbackText(trend ? [trend] : [], 260),
    trend: trend || '',
    advice,
  }

  return Response.json(result)
}
