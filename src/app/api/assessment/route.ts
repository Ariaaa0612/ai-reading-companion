import { assessmentStorage, quizStorage, getAnswerOverallScore } from '@/lib/storage'
import type { DimensionScore, ThinkingDimension } from '@/types'

/**
 * 阅读能力测评接口
 *
 * GET：获取当前用户测评数据
 *   - 使用天数 < 1（尚未打卡）→ { ready: false, daysNeeded: 1, currentDays }
 *   - 使用天数 >= 1（首次打卡后）→ { ready: true, dimensionScores, summary, dayCount }
 *
 * POST：保存测评结果到 assessmentStorage
 *   请求体：{ date, dimensionScores, summary, dayCount }
 */

const REQUIRED_DAYS = 1

const DIMENSIONS: ThinkingDimension[] = [
  '理解力',
  '批判性思维',
  '联想力',
  '表达力',
  '反思力',
]

interface AssessmentNotReady {
  ready: false
  daysNeeded: number
  currentDays: number
}

interface ImprovementAction {
  dimension: ThinkingDimension
  title: string
  actions: string[]
}

interface AssessmentReady {
  ready: true
  dimensionScores: DimensionScore[]
  summary: string
  dayCount: number
  improvement: ImprovementAction
}

type AssessmentResponse = AssessmentNotReady | AssessmentReady

interface SaveAssessmentRequest {
  date: string
  dimensionScores: DimensionScore[]
  summary: string
  dayCount: number
}

/** 计算五个维度的分数：每维度取有效分数（五维收尾评分均值或 aiScore>0）的平均，无有效分数默认 5 */
function computeDimensionScores(): DimensionScore[] {
  return DIMENSIONS.map((dimension) => {
    const answers = quizStorage.listByDimension(dimension)
    const scores = answers
      .map((a) => getAnswerOverallScore(a))
      .filter((s): s is number => s !== null)
    if (scores.length === 0) {
      return { dimension, score: 5 }
    }
    const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length
    return { dimension, score: Math.round(avg * 10) / 10 }
  })
}

/** 根据五维度分数生成总评语 */
function generateSummary(scores: DimensionScore[], dayCount: number): string {
  const sorted = [...scores].sort((a, b) => b.score - a.score)
  const top = sorted[0]
  const bottom = sorted[sorted.length - 1]
  const avg = Math.round((scores.reduce((sum, d) => sum + d.score, 0) / scores.length) * 10) / 10

  const parts: string[] = []
  parts.push(`你已坚持阅读 ${dayCount} 天，五维度平均分 ${avg} 分`)

  if (top.score >= 7) {
    parts.push(`其中「${top.dimension}」表现最突出（${top.score} 分），是你当前的思维优势区`)
  } else {
    parts.push(`整体处于稳步积累阶段，各项能力相对均衡`)
  }

  if (bottom.score < 6) {
    parts.push(`「${bottom.dimension}」（${bottom.score} 分）还有较大提升空间`)
  }

  parts.push('建议在保持优势的同时，针对薄弱维度多做刻意练习')
  return parts.join('，') + '。'
}

/** 根据最薄弱维度生成个性化提升指南 */
function generateImprovement(scores: DimensionScore[]): ImprovementAction {
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
  return {
    dimension: weakest.dimension,
    title: guide.title,
    actions: guide.actions,
  }
}

export async function GET() {
  try {
    const dayCount = assessmentStorage.getUsageDays()

    if (dayCount < REQUIRED_DAYS) {
      const notReady: AssessmentNotReady = {
        ready: false,
        daysNeeded: REQUIRED_DAYS,
        currentDays: dayCount,
      }
      return Response.json(notReady)
    }

    const dimensionScores = computeDimensionScores()
    const summary = generateSummary(dimensionScores, dayCount)
    const improvement = generateImprovement(dimensionScores)

    // 存储薄弱维度（供 quiz/analyze 进阶期评分使用）
    const sorted = [...dimensionScores].sort((a, b) => a.score - b.score)
    void assessmentStorage.setWeakDimension(sorted[0].dimension, sorted[0].score)

    const ready: AssessmentReady = {
      ready: true,
      dimensionScores,
      summary,
      dayCount,
      improvement,
    }
    return Response.json(ready satisfies AssessmentResponse)
  } catch (e) {
    console.error('[api/assessment GET] error:', e)
    return Response.json(
      { ready: false, daysNeeded: REQUIRED_DAYS, currentDays: 0 } satisfies AssessmentNotReady,
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<SaveAssessmentRequest>

    if (!body.dimensionScores || !body.summary || typeof body.dayCount !== 'number') {
      return Response.json({ success: false, error: '测评数据不完整' }, { status: 400 })
    }

    const date = body.date ?? new Date().toISOString().slice(0, 10)

    const saved = await assessmentStorage.save({
      date,
      dimensionScores: body.dimensionScores,
      summary: body.summary,
      dayCount: body.dayCount,
    })

    return Response.json({ success: true, data: saved })
  } catch (e) {
    console.error('[api/assessment POST] error:', e)
    return Response.json({ success: false, error: '保存测评失败' }, { status: 500 })
  }
}
