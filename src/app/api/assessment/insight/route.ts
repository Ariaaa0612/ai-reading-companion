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
  points: string[]
  advice: string[]
}

const SYSTEM_PROMPT = `你是一位阅读思维教练，为普通读者写阅读能力测评的评语。

你会收到用户多天的作答统计数据：每天的五个维度得分与整体均分、加权后各维度得分、以及最近一天相较前一天的变化。

请输出严格的 JSON：
{
  "points": ["要点一（不超过45字）", "要点二（不超过45字）"],
  "advice": ["建议1（不超过40字，可当天执行）", "建议2（不超过40字，可当天执行）"]
}

points 必须正好两条，各写一个层面：
- 第一条：整体层面——跨天变化。说清哪天的均分到哪天变成了多少，上升/回落/持平，落到具体分数。
- 第二条：维度层面——强弱结构。点名最强与最弱维度及其分数，一句话给出方向判断。

写作要求：
1. 每句话信息密度要高，不铺垫、不总结、不重复题目里的原话。
2. 不要用"赋能""飞跃""显著提升"这类空话，也不用形容词堆砌。
3. 只有 1 天数据时，第一条改写为"当前基线 + 下一步重点"，不要编造对比。
4. advice 必须具体到能立刻做的动作，不要"多读书""多练习"。
5. 不评价人格，只评价这次的表现与变化。
6. 只输出 JSON，不要 markdown 代码块，不要任何解释文字。`

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

  const points = Array.isArray(parsed.points)
    ? parsed.points
        .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        .map((p) => p.trim())
        .slice(0, 2)
    : []
  const advice = Array.isArray(parsed.advice)
    ? parsed.advice
        .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
        .map((a) => a.trim())
        .slice(0, 2)
    : []

  // 两条要点缺一不可，否则视为不合格，让前端走模板兜底
  if (points.length < 2) {
    return Response.json({ ai: false })
  }

  const result: InsightResult & { ai: true } = { ai: true, points, advice }

  return Response.json(result)
}
