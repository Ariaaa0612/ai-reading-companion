'use client'

import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { assessmentStorage, quizStorage, syncAllFromCloud } from '@/lib/storage'
import {
  DIMENSIONS,
  buildInsightPayload,
  buildTemplateSummary,
  computeDailyPerformance,
  computeTrend,
  computeWeightedScores,
  type DailyPerformance,
  type TrendSummary,
} from '@/lib/assessment'
import { track } from '@/lib/tracker'
import type { DimensionScore, ThinkingDimension } from '@/types'

// ===== 雷达图配置 =====
const DIMENSIONS_ORDER: ThinkingDimension[] = DIMENSIONS

const DIMENSION_DESC: Record<ThinkingDimension, string> = {
  理解力: '准确概括文章核心，用自己的话复述要点',
  批判性思维: '独立判断，敢于质疑并给出有依据的理由',
  联想力: '将文章与自身经验或其他知识建立连接',
  表达力: '结构清晰、用词准确地表达观点',
  反思力: '审视自身认知变化与思维盲点',
}

const REQUIRED_DAYS = 1

// SVG 雷达图参数
const SVG_SIZE = 320
const CX = 160
const CY = 150
const R = 100

interface ImprovementAction {
  dimension: ThinkingDimension
  title: string
  actions: string[]
}

interface AssessmentReady {
  ready: true
  dimensionScores: DimensionScore[]
  /** 模板评语（先展示，AI 返回后替换） */
  summary: string
  /** AI 返回的一句话趋势 */
  trendText: string
  /** AI 是否生效 */
  aiEnhanced: boolean
  /** AI 给出的可执行建议，为空时用 improvement.actions */
  aiAdvice: string[]
  dayCount: number
  improvement: ImprovementAction
  trend: TrendSummary
  daily: DailyPerformance[]
}

interface AssessmentNotReady {
  ready: false
  daysNeeded: number
  currentDays: number
}

type AssessmentData = AssessmentReady | AssessmentNotReady

/** 根据最薄弱维度生成个性化提升指南 */
function buildImprovement(scores: DimensionScore[]): ImprovementAction {
  const sorted = [...scores].sort((a, b) => a.score - b.score)
  const weakest = sorted[0]

  const guides: Record<ThinkingDimension, { title: string; actions: string[] }> = {
    理解力: {
      title: '读懂文章核心',
      actions: [
        '读完文章后，试着用一句话概括全文在说什么。如果说不出来，就回头再扫一遍。',
        '把文章里最重要的三个词圈出来，想想它们之间是什么关系。',
      ],
    },
    批判性思维: {
      title: '形成自己的判断',
      actions: [
        '下次回答时，试着加一句「但是…」，说出你不同意或觉得有问题的地方。',
        '问自己一个问题：如果有人反驳这篇文章，他会怎么说？',
      ],
    },
    联想力: {
      title: '把文章和生活连起来',
      actions: [
        '读完文章后，想一个你自己生活里的例子，跟文章里的事对比一下。',
        '问自己：这篇文章让我想到了什么人、什么事、什么经历？',
      ],
    },
    表达力: {
      title: '把想法说清楚',
      actions: [
        '回答时试着用「首先…其次…最后…」的顺序来说，哪怕只有两三句话。',
        '说完之后检查一下：别人只看我的回答，能听懂我在说什么吗？',
      ],
    },
    反思力: {
      title: '看见自己的变化',
      actions: [
        '读完文章后问自己：如果回到读之前，我会给自己什么建议？',
        '每隔几天翻翻自己之前的回答，看看想法有没有变化。',
      ],
    },
  }

  const guide = guides[weakest.dimension]
  return { dimension: weakest.dimension, title: guide.title, actions: guide.actions }
}

// ===== 雷达图几何计算 =====
function vertex(i: number, r: number): { x: number; y: number } {
  const angle = ((-90 + i * 72) * Math.PI) / 180
  return { x: CX + r * Math.cos(angle), y: CY + r * Math.sin(angle) }
}

function polygonPoints(r: number): string {
  return DIMENSIONS_ORDER.map((_, i) => {
    const p = vertex(i, r)
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
  }).join(' ')
}

function dataPoints(scores: number[]): string {
  return scores
    .map((s, i) => {
      const p = vertex(i, R * (Math.max(0, Math.min(10, s)) / 10))
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
    })
    .join(' ')
}

function labelAnchor(i: number): { anchor: 'start' | 'middle' | 'end'; dy: number } {
  const p = vertex(i, 1)
  let anchor: 'start' | 'middle' | 'end' = 'middle'
  if (p.x > CX + 0.3) anchor = 'start'
  else if (p.x < CX - 0.3) anchor = 'end'
  const dy = p.y < CY - 0.3 ? -6 : p.y > CY + 0.3 ? 14 : 4
  return { anchor, dy }
}

function RadarChart({ scores }: { scores: DimensionScore[] }) {
  const scoreByDim = new Map(scores.map((d) => [d.dimension, d.score]))
  const ordered = DIMENSIONS_ORDER.map((d) => scoreByDim.get(d) ?? 0)
  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1]

  return (
    <svg
      viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
      className="h-auto w-full max-w-[320px] mx-auto"
      role="img"
      aria-label="五维度能力雷达图"
    >
      {gridLevels.map((lvl) => (
        <polygon
          key={lvl}
          points={polygonPoints(R * lvl)}
          fill="none"
          stroke="oklch(0.922 0 0)"
          strokeWidth={1}
        />
      ))}

      {DIMENSIONS_ORDER.map((_, i) => {
        const p = vertex(i, R)
        return (
          <line
            key={i}
            x1={CX}
            y1={CY}
            x2={p.x}
            y2={p.y}
            stroke="oklch(0.922 0 0)"
            strokeWidth={1}
          />
        )
      })}

      <polygon
        points={dataPoints(ordered)}
        fill="oklch(0.55 0.18 250 / 0.25)"
        stroke="oklch(0.55 0.18 250)"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {ordered.map((s, i) => {
        const p = vertex(i, R * (Math.max(0, Math.min(10, s)) / 10))
        return <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="oklch(0.55 0.18 250)" />
      })}

      {DIMENSIONS_ORDER.map((dim, i) => {
        const p = vertex(i, R + 18)
        const { anchor, dy } = labelAnchor(i)
        const score = scoreByDim.get(dim) ?? 0
        return (
          <g key={dim}>
            <text
              x={p.x}
              y={p.y + dy}
              textAnchor={anchor}
              className="fill-foreground"
              style={{ fontSize: 12, fontWeight: 600 }}
            >
              {dim}
            </text>
            <text
              x={p.x}
              y={p.y + dy + 14}
              textAnchor={anchor}
              className="fill-muted-foreground"
              style={{ fontSize: 11 }}
            >
              {score}/10
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** 跨天趋势卡：最近 5 天的均分条形 + 与前一天的差值 */
function TrendCard({ daily, trend }: { daily: DailyPerformance[]; trend: TrendSummary }) {
  const recent = daily.slice(-5)
  const deltaText =
    trend.delta === null
      ? null
      : trend.direction === 'up'
        ? `较前一天提升 ${trend.delta} 分`
        : trend.direction === 'down'
          ? `较前一天回落 ${Math.abs(trend.delta)} 分`
          : `与前一天的 ${trend.previousAvg} 分基本持平`

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>跨天趋势</span>
          <Badge variant="secondary">近 {recent.length} 天</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {deltaText && (
          <p
            className={`text-sm font-medium ${
              trend.direction === 'up'
                ? 'text-emerald-600'
                : trend.direction === 'down'
                  ? 'text-destructive'
                  : 'text-muted-foreground'
            }`}
          >
            {deltaText}
          </p>
        )}
        <div className="flex flex-col gap-2.5">
          {recent.map((day, idx) => {
            const isLatest = idx === recent.length - 1
            return (
              <div key={day.date} className="flex items-center gap-3">
                <span
                  className={`w-12 shrink-0 text-xs tabular-nums ${
                    isLatest ? 'font-semibold text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {day.date.slice(5)}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${isLatest ? 'bg-primary' : 'bg-primary/40'}`}
                    style={{ width: `${Math.max(4, Math.min(100, day.avg * 10))}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {day.avg}
                </span>
              </div>
            )
          })}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          综合分采用近期加权：最近一天 50%、前一天 30%、再前一天 20%，更能反映你当前的状态。
        </p>
      </CardContent>
    </Card>
  )
}

export default function AssessmentPage() {
  const [data, setData] = useState<AssessmentData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadAssessment()
  }, [])

  async function loadAssessment() {
    setLoading(true)
    setError(null)
    try {
      // 关键修复：先同步云端，跨设备/跨域名也能拿到历史作答
      try {
        await syncAllFromCloud()
      } catch (e) {
        console.warn('[assessment] syncAllFromCloud skipped:', e)
      }

      const answers = quizStorage.list()
      const daily = computeDailyPerformance(answers)
      const usageDays = assessmentStorage.getUsageDays()
      const dayCount = Math.max(usageDays, daily.length)

      if (dayCount < REQUIRED_DAYS || daily.length === 0) {
        setData({ ready: false, daysNeeded: REQUIRED_DAYS, currentDays: dayCount })
        return
      }

      const dimensionScores = computeWeightedScores(daily)
      const trend = computeTrend(daily)
      const improvement = buildImprovement(dimensionScores)
      const summary = buildTemplateSummary(dimensionScores, trend)

      // 先渲染本地计算结果，AI 评语异步补上
      setData({
        ready: true,
        dimensionScores,
        summary,
        trendText: '',
        aiEnhanced: false,
        aiAdvice: [],
        dayCount,
        improvement,
        trend,
        daily,
      })

      // 记录薄弱维度（供 quiz/analyze 进阶期评分使用）
      const sorted = [...dimensionScores].sort((a, b) => a.score - b.score)
      void assessmentStorage.setWeakDimension(sorted[0].dimension, sorted[0].score)

      void track('assessment_viewed', {
        day_count: dayCount,
        weakest_dimension: sorted[0]?.dimension,
        weakest_score: sorted[0]?.score,
        avg_score: (
          dimensionScores.reduce((s, d) => s + d.score, 0) / dimensionScores.length
        ).toFixed(1),
      })

      // 异步获取 AI 综合分析（失败不影响页面）
      void loadInsight(daily, dimensionScores, trend, dayCount, improvement)
    } catch (e) {
      console.error('加载测评数据失败', e)
      setError('加载测评数据失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  async function loadInsight(
    daily: DailyPerformance[],
    dimensionScores: DimensionScore[],
    trend: TrendSummary,
    dayCount: number,
    improvement: ImprovementAction
  ) {
    try {
      const res = await fetch('/api/assessment/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildInsightPayload(daily, dimensionScores, trend)),
      })
      if (!res.ok) return
      const json = (await res.json()) as {
        ai?: boolean
        summary?: string
        trend?: string
        advice?: string[]
      }
      if (!json.ai) return

      setData((prev) => {
        if (!prev || !prev.ready) return prev
        return {
          ...prev,
          summary: json.summary?.trim() ? json.summary.trim() : prev.summary,
          trendText: json.trend?.trim() ?? '',
          aiEnhanced: true,
          aiAdvice: Array.isArray(json.advice) ? json.advice.slice(0, 3) : [],
          dayCount,
          improvement,
        }
      })
    } catch (e) {
      console.warn('[assessment] insight failed (non-critical):', e)
    }
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-[430px] bg-background pb-20">
      {/* 标题 */}
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-semibold">阅读能力测评</h1>
        <p className="text-xs text-muted-foreground">基于全部作答、近期表现加权</p>
      </header>

      <ScrollArea className="h-[calc(100vh-64px)]">
        <div className="flex flex-col gap-4 p-4">
          {loading ? (
            <>
              <Skeleton className="h-64 w-full rounded-xl" />
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </>
          ) : error ? (
            <Card>
              <CardContent>
                <p className="py-6 text-center text-sm text-destructive">{error}</p>
              </CardContent>
            </Card>
          ) : data && data.ready ? (
            <>
              {/* 雷达图 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>五维能力雷达图</span>
                    <Badge variant="secondary">第 {data.dayCount} 天</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <RadarChart scores={data.dimensionScores} />
                </CardContent>
              </Card>

              {/* 跨天趋势 */}
              {data.daily.length >= 1 && <TrendCard daily={data.daily} trend={data.trend} />}

              {/* 各维度详情 */}
              <Card>
                <CardHeader>
                  <CardTitle>维度详情</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {data.dimensionScores.map((d) => (
                    <div key={d.dimension} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{d.dimension}</span>
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {d.score}/10
                        </span>
                      </div>
                      <Progress value={d.score * 10} />
                      <p className="text-xs text-muted-foreground">{DIMENSION_DESC[d.dimension]}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* 总评（AI 综合 / 模板兜底） */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>综合评语</span>
                    <Badge variant={data.aiEnhanced ? 'default' : 'secondary'} className="text-xs">
                      {data.aiEnhanced ? 'AI 综合分析' : '本地分析'}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="text-sm leading-relaxed text-foreground">{data.summary}</p>
                  {data.trendText && (
                    <p className="rounded-lg bg-primary/5 p-2.5 text-xs leading-relaxed text-primary">
                      {data.trendText}
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* 个性化提升指南 */}
              <Card className="border-primary/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <span>专属提升指南</span>
                    <Badge variant="secondary" className="text-xs">
                      针对「{data.improvement.dimension}」
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="text-sm font-medium text-foreground">{data.improvement.title}</p>
                  <div className="flex flex-col gap-2">
                    {(data.aiAdvice.length > 0 ? data.aiAdvice : data.improvement.actions).map(
                      (action, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-2 rounded-lg bg-primary/5 p-2.5"
                        >
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                            {idx + 1}
                          </span>
                          <span className="text-sm leading-relaxed text-foreground">{action}</span>
                        </div>
                      )
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    从最薄弱的维度开始练，每次只做一件事，效果最明显。
                  </p>
                </CardContent>
              </Card>
            </>
          ) : data && !data.ready ? (
            <Card>
              <CardHeader>
                <CardTitle>测评尚未解锁</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  完成首次打卡后即可生成测评，评估你当下的思考状态。坚持阅读，你的能力画像会越来越清晰。
                </p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">当前进度</span>
                    <span className="tabular-nums">
                      {data.currentDays} / {data.daysNeeded} 天
                    </span>
                  </div>
                  <Progress value={(data.currentDays / data.daysNeeded) * 100} />
                </div>
                <p className="text-xs text-muted-foreground">
                  阅读文章并完成思考题即算打卡，首次打卡后即可查看五维度测评。
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}
