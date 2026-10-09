import type { ApiResponse, ThinkingDimension } from '@/types'
import { callAIForJSON } from '@/lib/ai'
import { SCORING_SYSTEM_PROMPT, buildScoringUserMessage } from '@/lib/prompts/scoring'
import { validateScoringResult } from '@/lib/ai-validators'
import { truncateText } from '@/lib/utils'

/**
 * 思考题回答分析接口
 *
 * 改造后：使用真实 AI（DeepSeek）进行评分和回应
 * 输出校验：response 20-80字、assessment 50-300字、无打趣奉承
 * 失败时退回模板版兜底
 *
 * 请求体：{
 *   articleId, questionId, questionText, dimension, userAnswer,
 *   articleTitle?, articleSummary?,
 *   checkInDays?, weakDimension?, hasImproved?
 * }
 */

interface QuizAnalyzeRequest {
  articleId: string
  questionId: string
  questionText: string
  dimension: ThinkingDimension
  userAnswer: string
  articleTitle?: string
  articleSummary?: string
  checkInDays?: number
  weakDimension?: ThinkingDimension | null
  hasImproved?: boolean
}

interface QuizAnalyzeResult {
  aiScore: number
  aiAnalysis: string
  valid: boolean
  validationMessage?: string
  stage: string
  response?: string
  assessment?: string
}

type EvaluationStage = '启蒙期' | '成长期' | '进阶期'

// ===== 敷衍检测（前置快速校验） =====

const FILLER_WORDS = [
  '是', '不是', '对', '不对', '好', '不好', '行', '不行',
  '嗯', '啊', '哦', '呃', '哈', '呵', '唉',
  '是的', '对的', '好的', '不知道', '不清楚', '随便', '无所谓',
  '可以', '不可以', '没错', '是的吧',
]

const MIN_MEANINGFUL_LENGTH = 8

function validateAnswer(answer: string): { valid: boolean; message?: string } {
  const trimmed = answer.trim()
  if (trimmed.length < MIN_MEANINGFUL_LENGTH) {
    return { valid: false, message: '感觉你还没展开说呢，能再多聊聊你的想法吗？' }
  }
  if (FILLER_WORDS.includes(trimmed)) {
    return { valid: false, message: '这样回答有点简单啦，说说你为什么这么想？' }
  }
  // 语气词/感叹字占比过高 → 视为敷衍（"哈哈哈哈""嗯呃呃呃"等堆砌，虽够长但无实质内容）
  const terseChars = '哈哈嗯呃啊哦唉呵诶哎哦'
  let terseCount = 0
  for (const ch of trimmed) {
    if (terseChars.includes(ch)) terseCount++
  }
  if (terseCount / trimmed.length >= 0.5) {
    return { valid: false, message: '这样可以再多聊一点吗？说一个自己的想法或例子，我会更有针对性。' }
  }
  return { valid: true }
}

// ===== 阶段判定 =====

function getStage(dayCount: number, hasImproved: boolean): EvaluationStage {
  if (dayCount <= 3) return '启蒙期'
  if (dayCount < 14) return '成长期'
  return hasImproved ? '成长期' : '进阶期'
}

function getStageCode(stage: EvaluationStage): string {
  switch (stage) {
    case '启蒙期': return 'enlighten'
    case '成长期': return 'growth'
    case '进阶期': return 'advanced'
  }
}

// ===== 兜底模板 =====

function fallbackResponse(
  answer: string,
  dimension: ThinkingDimension,
  stage: EvaluationStage
): QuizAnalyzeResult {
  const analysis = `你的回答已经被收到。由于 AI 服务暂时不可用，这里给你一个基础反馈：\n\n继续展开你的想法，试着加上"因为……"来说明理由，再举一个生活中的例子来佐证你的观点。`
  return {
    aiScore: 0,
    aiAnalysis: analysis,
    valid: true,
    stage,
    response: '你的回答我收到了，不过 AI 服务暂时有点忙，稍后可以再试试深度对话。',
    assessment: analysis,
  }
}

// ===== 接口处理 =====

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<QuizAnalyzeRequest>

    const dimension = body.dimension
    const userAnswer = body.userAnswer

    if (!dimension || !userAnswer) {
      return Response.json(
        { success: false, error: '回答内容或维度缺失，无法分析' } satisfies ApiResponse<never>,
        { status: 400 }
      )
    }

    const answer = userAnswer.trim()
    if (answer.length === 0) {
      return Response.json(
        { success: false, error: '回答内容不能为空，请先写下你的思考再提交。' } satisfies ApiResponse<never>,
        { status: 400 }
      )
    }

    // ===== 敷衍作答前置校验 =====
    const validation = validateAnswer(answer)
    if (!validation.valid) {
      return Response.json(
        {
          success: true,
          data: {
            aiScore: 0,
            aiAnalysis: '',
            valid: false,
            validationMessage: validation.message,
            stage: '启蒙期' as EvaluationStage,
          }
        } satisfies ApiResponse<QuizAnalyzeResult>
      )
    }

    // ===== 阶段判定 =====
    const dayCount = body.checkInDays ?? 0
    const hasImproved = body.hasImproved ?? false
    const stage = getStage(dayCount, hasImproved)
    const stageCode = getStageCode(stage)

    // ===== 调用 AI（文章内容截断到 500 字，token 控制） =====
    const article = truncateText(`${body.articleTitle ?? ''}\n\n${body.articleSummary ?? ''}`, 500)
    const userMessage = buildScoringUserMessage({
      article,
      question: body.questionText ?? '',
      userAnswer: answer,
      stage: stageCode,
    })

    const rawResult = await callAIForJSON<unknown>(SCORING_SYSTEM_PROMPT, userMessage)

    // ===== 输出校验 =====
    const aiResult = rawResult ? validateScoringResult(rawResult) : null

    // 校验失败 → 兜底
    if (!aiResult) {
      console.error('[quiz/analyze] AI output validation failed, using fallback')
      const fallback = fallbackResponse(answer, dimension, stage)
      return Response.json(
        { success: true, data: fallback } satisfies ApiResponse<QuizAnalyzeResult>
      )
    }

    // 校验通过
    const combinedAnalysis = `${aiResult.response}\n\n${aiResult.assessment}`
    return Response.json(
      {
        success: true,
        data: {
          aiScore: 0,
          aiAnalysis: combinedAnalysis,
          valid: true,
          stage,
          response: aiResult.response,
          assessment: aiResult.assessment,
        }
      } satisfies ApiResponse<QuizAnalyzeResult>
    )
  } catch (e) {
    console.error('[api/quiz/analyze] error:', e)
    return Response.json(
      { success: false, error: '分析失败，请稍后重试' } satisfies ApiResponse<never>,
      { status: 500 }
    )
  }
}
