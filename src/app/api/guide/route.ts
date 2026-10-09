import type { ApiResponse } from '@/types'
import { callAIForJSON } from '@/lib/ai'
import { GUIDE_SYSTEM_PROMPT, buildGuideUserMessage } from '@/lib/prompts/guide'
import { validateGuideResult } from '@/lib/ai-validators'

/**
 * 思考指南接口（Prompt 3）
 *
 * 汇总本阶段所有打卡回答，AI 给出：
 * - 五维阶段均分（雷达图数据）
 * - 问题列表
 * - 综合分析
 * - 实操建议
 * - 小目标列表
 *
 * 失败时退回模板版兜底
 *
 * 请求体：{
 *   stage: string,                    // enlighten / growth / advanced
 *   checkInCount: number,             // 本阶段打卡次数
 *   stageAnswersSummary: string,      // 本阶段所有打卡回答汇总文本
 * }
 */

interface GuideRequest {
  stage: string
  checkInCount: number
  stageAnswersSummary: string
}

interface GuideResponse {
  stageScores: {
    independent_thinking: number
    evidence_quality: number
    logic_structure: number
    word_precision: number
    reflection_depth: number
  }
  problems: string[]
  analysis: string
  actionableAdvice: string
  smallGoals: string[]
}

// ===== 兜底模板 =====

function fallbackGuide(stage: string, checkInCount: number): GuideResponse {
  return {
    stageScores: {
      independent_thinking: 5,
      evidence_quality: 5,
      logic_structure: 5,
      word_precision: 5,
      reflection_depth: 5,
    },
    problems: ['由于 AI 服务暂时不可用，无法生成个性化问题分析。'],
    analysis: `你在本阶段完成了 ${checkInCount} 次打卡，值得坚持。由于 AI 服务暂时不可用，这里给你一个基础反馈：\n\n继续坚持每天阅读和回答思考题，每次回答时尝试加入至少一个个人经历或具体例子。表达上注意减少口语填充词，让观点更清晰有力。`,
    actionableAdvice: '每次回答前，先花 30 秒想一个自己经历过的相关场景，把它写进去作为论据。',
    smallGoals: ['连续 2 次回答都包含至少 1 个具体例子'],
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<GuideRequest>

    const stage = body.stage ?? 'enlighten'
    const checkInCount = body.checkInCount ?? 0
    const stageAnswersSummary = body.stageAnswersSummary ?? ''

    if (!stageAnswersSummary || stageAnswersSummary.trim().length === 0) {
      return Response.json(
        { success: false, error: '本阶段暂无打卡记录，无法生成思考指南。' } satisfies ApiResponse<never>,
        { status: 400 }
      )
    }

    // 调用 AI
    const userMessage = buildGuideUserMessage({
      stage,
      checkInCount,
      stageAnswersSummary,
    })

    const rawResult = await callAIForJSON<unknown>(GUIDE_SYSTEM_PROMPT, userMessage)

    // 输出校验
    const aiResult = rawResult ? validateGuideResult(rawResult) : null

    // 校验失败 → 兜底
    if (!aiResult) {
      console.error('[guide] AI output validation failed, using fallback')
      const fallback = fallbackGuide(stage, checkInCount)
      return Response.json(
        { success: true, data: fallback } satisfies ApiResponse<GuideResponse>
      )
    }

    // 校验通过 — 组装返回
    return Response.json(
      {
        success: true,
        data: {
          stageScores: aiResult.stage_scores,
          problems: aiResult.problems,
          analysis: aiResult.analysis,
          actionableAdvice: aiResult.actionable_advice,
          smallGoals: aiResult.small_goals,
        }
      } satisfies ApiResponse<GuideResponse>
    )
  } catch (e) {
    console.error('[api/guide] error:', e)
    return Response.json(
      { success: false, error: '生成思考指南失败，请稍后重试' } satisfies ApiResponse<never>,
      { status: 500 }
    )
  }
}
