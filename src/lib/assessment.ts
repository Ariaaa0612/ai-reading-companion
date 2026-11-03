/**
 * 测评核心算法（纯函数，无副作用）
 *
 * 目标：把「所有历史回答」按天分桶，再按时间远近加权，得出能体现变化的综合评分。
 * 之前的问题：所有回答直接平均 → 第 1 天和第 100 天等权，看不出进步。
 */

import type { DimensionScore, QuizAnswer, ThinkingDimension } from '@/types'
import { getAnswerOverallScore } from '@/lib/storage'

export const DIMENSIONS: ThinkingDimension[] = [
  '理解力',
  '批判性思维',
  '联想力',
  '表达力',
  '反思力',
]

/** 最近 N 天的权重：越近权重越大 */
const RECENT_WEIGHTS = [0.5, 0.3, 0.2]

export interface DailyPerformance {
  /** YYYY-MM-DD */
  date: string
  /** 当天各维度均分（无有效回答的维度为 null） */
  dimensionScores: Partial<Record<ThinkingDimension, number>>
  /** 当天整体均分 */
  avg: number
  /** 当天纳入统计的已评分回答数 */
  answerCount: number
}

/** 把回答按自然日分桶，按日期升序 */
export function computeDailyPerformance(answers: QuizAnswer[]): DailyPerformance[] {
  const buckets = new Map<string, QuizAnswer[]>()

  for (const a of answers) {
    const stamp = a.completedAt ?? a.createdAt
    if (!stamp) continue
    // 与打卡记录统一用同一套日期口径，避免跨天错位
    const date = new Date(stamp).toISOString().slice(0, 10)
    const list = buckets.get(date)
    if (list) list.push(a)
    else buckets.set(date, [a])
  }

  const daily: DailyPerformance[] = []

  for (const [date, list] of buckets) {
    const dimensionScores: Partial<Record<ThinkingDimension, number>> = {}
    const allScores: number[] = []

    for (const dimension of DIMENSIONS) {
      const scores = list
        .filter((a) => a.dimension === dimension)
        .map((a) => getAnswerOverallScore(a))
        .filter((s): s is number => s !== null)
      if (scores.length > 0) {
        const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length
        dimensionScores[dimension] = Math.round(avg * 10) / 10
        allScores.push(...scores)
      }
    }

    if (allScores.length === 0) continue

    const avg = allScores.reduce((sum, s) => sum + s, 0) / allScores.length
    daily.push({
      date,
      dimensionScores,
      avg: Math.round(avg * 10) / 10,
      answerCount: allScores.length,
    })
  }

  return daily.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * 综合各维度分数：取最近 3 天，按 0.5 / 0.3 / 0.2 加权。
 * 不足 3 天时按已有天数的权重重归一化，保证不会因为天数少而虚低。
 * 某维度完全没有数据时给 5 分（中性值，避免误判为薄弱）。
 */
export function computeWeightedScores(daily: DailyPerformance[]): DimensionScore[] {
  const recent = daily.slice(-RECENT_WEIGHTS.length).slice().reverse() // 最近一天在前

  return DIMENSIONS.map((dimension) => {
    let weightedSum = 0
    let weightTotal = 0

    recent.forEach((day, index) => {
      const score = day.dimensionScores[dimension]
      if (score === undefined) return
      const weight = RECENT_WEIGHTS[index]
      weightedSum += score * weight
      weightTotal += weight
    })

    if (weightTotal === 0) return { dimension, score: 5 }
    return { dimension, score: Math.round((weightedSum / weightTotal) * 10) / 10 }
  })
}

export interface TrendSummary {
  /** 最近一天均分 */
  latestAvg: number | null
  /** 前一天均分 */
  previousAvg: number | null
  /** 变化值（正为进步） */
  delta: number | null
  /** 变化方向 */
  direction: 'up' | 'down' | 'flat' | null
  /** 跨天综合均分（全部天等权，用于展示总水平） */
  overallAvg: number | null
  dayCount: number
}

/** 计算跨天趋势：只看最近两天差值与整体水平 */
export function computeTrend(daily: DailyPerformance[]): TrendSummary {
  if (daily.length === 0) {
    return {
      latestAvg: null,
      previousAvg: null,
      delta: null,
      direction: null,
      overallAvg: null,
      dayCount: 0,
    }
  }

  const latest = daily[daily.length - 1]
  const previous = daily.length >= 2 ? daily[daily.length - 2] : null
  const overallAvg =
    Math.round((daily.reduce((sum, d) => sum + d.avg, 0) / daily.length) * 10) / 10

  if (!previous) {
    return {
      latestAvg: latest.avg,
      previousAvg: null,
      delta: null,
      direction: null,
      overallAvg,
      dayCount: daily.length,
    }
  }

  const delta = Math.round((latest.avg - previous.avg) * 10) / 10
  return {
    latestAvg: latest.avg,
    previousAvg: previous.avg,
    delta,
    direction: delta > 0.15 ? 'up' : delta < -0.15 ? 'down' : 'flat',
    overallAvg,
    dayCount: daily.length,
  }
}

/** 模板兜底评语（AI 不可用时使用），但已包含跨天对比 */
export function buildTemplateSummary(
  scores: DimensionScore[],
  trend: TrendSummary
): string {
  const sorted = [...scores].sort((a, b) => b.score - a.score)
  const top = sorted[0]
  const bottom = sorted[sorted.length - 1]
  const avg =
    scores.length > 0
      ? Math.round((scores.reduce((sum, d) => sum + d.score, 0) / scores.length) * 10) / 10
      : 0

  const parts: string[] = []
  parts.push(
    `你已在 ${trend.dayCount} 天里累计作答，综合五维加权平均 ${avg} 分（近期表现权重更高）`
  )

  if (trend.direction === 'up' && trend.delta !== null) {
    parts.push(`最近一天 ${trend.latestAvg} 分，比前一天的 ${trend.previousAvg} 分提高了 ${trend.delta} 分，进步可见`)
  } else if (trend.direction === 'down' && trend.delta !== null) {
    parts.push(`最近一天 ${trend.latestAvg} 分，比前一天的 ${trend.previousAvg} 分回落了 ${Math.abs(trend.delta)} 分，状态有波动`)
  } else if (trend.direction === 'flat') {
    parts.push(`最近一天 ${trend.latestAvg} 分，与前一天的 ${trend.previousAvg} 分基本持平，处在平台期`)
  }

  if (top.score >= 7) {
    parts.push(`「${top.dimension}」最突出（${top.score} 分），是你当前的思维优势区`)
  }
  if (bottom.score < 6) {
    parts.push(`「${bottom.dimension}」（${bottom.score} 分）还有较大提升空间`)
  }

  return parts.join('，') + '。'
}

/** 给 AI 的输入摘要（不含原文与个人身份信息） */
export function buildInsightPayload(
  daily: DailyPerformance[],
  scores: DimensionScore[],
  trend: TrendSummary
) {
  return {
    dayCount: trend.dayCount,
    daily: daily.map((d) => ({
      date: d.date,
      avg: d.avg,
      answerCount: d.answerCount,
      dimensions: d.dimensionScores,
    })),
    weightedScores: scores.map((s) => ({ dimension: s.dimension, score: s.score })),
    trend: {
      latestAvg: trend.latestAvg,
      previousAvg: trend.previousAvg,
      delta: trend.delta,
      direction: trend.direction,
    },
  }
}
