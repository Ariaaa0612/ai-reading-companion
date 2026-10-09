import type { ApiResponse, ThinkingDimension } from '@/types'
import { callAIForJSON } from '@/lib/ai'
import { DIALOGUE_SYSTEM_PROMPT, buildDialogueUserMessage } from '@/lib/prompts/dialogue'
import { validateDialogueResult } from '@/lib/ai-validators'
import { truncateText } from '@/lib/utils'

/**
 * 思考题深挖对话接口
 *
 * 改造后：使用真实 AI（DeepSeek）进行苏格拉底式追问
 * 共五轮对话（用户初答 + 4 次 AI 追问），第 4 轮追问为总结性问题；
 * 用户回答总结性问题后进入第 5 轮（总结轮）：输出思考流程图 + 五维评分 + 引导，对话结束
 *
 * 输出校验：
 *   acknowledge 10-40字
 *   follow_up_question 第1-4轮仅含1个问号；第5轮（总结轮）为空字符串
 *   is_final_round 与 round 一致（第5轮必须为 true）
 *   第5轮：thought_flow 非空、article_scores 5个0-10整数、article_comment ≤50字、guide 非空
 *   非第5轮：以上字段为空
 *
 * 失败时退回模板版兜底
 *
 * 请求体：{
 *   message: string,
 *   articleTitle: string,
 *   articleSummary: string,
 *   articleKeyPoints?: string[],
 *   questionText: string,
 *   dimension: ThinkingDimension,
 *   firstAnswer?: string,
 *   aiAnalysis?: string,
 *   dialogueHistory: { role, content }[],
 *   checkInDays: number,
 * }
 */

interface ChatRequest {
  message: string
  articleTitle: string
  articleSummary: string
  articleKeyPoints?: string[]
  questionText: string
  dimension: ThinkingDimension
  firstAnswer?: string
  aiAnalysis?: string
  dialogueHistory: { role: string; content: string }[]
  checkInDays: number
}

interface ChatResult {
  reply: string
  acknowledge?: string
  followUpQuestion?: string
  isFinalRound?: boolean
  thoughtFlow?: string
  articleScores?: {
    independent_thinking: number
    evidence_quality: number
    logic_structure: number
    word_precision: number
    reflection_depth: number
  } | null
  articleComment?: string
  guideToThinkingGuide?: string
}

// ===== 兜底模板（文档 v2.1「Prompt 2 兜底：深度对话追问」原文模板） =====

const FALLBACK_TEMPLATES: Record<number, ChatResult> = {
  1: {
    reply: '你的观点很有意思。能举一个具体的例子来支持你的观点吗？',
    acknowledge: '你的观点很有意思。',
    followUpQuestion: '能举一个具体的例子来支持你的观点吗？',
    isFinalRound: false,
  },
  2: {
    reply: '例子很具体。如果从相反的角度来看，你觉得结论会有什么不同？',
    acknowledge: '例子很具体。',
    followUpQuestion: '如果从相反的角度来看，你觉得结论会有什么不同？',
    isFinalRound: false,
  },
  3: {
    reply: '你的思考越来越具体了。文章中提到的观点，和你刚才说的这些之间有什么联系？',
    acknowledge: '你的思考越来越具体了。',
    followUpQuestion: '文章中提到的观点，和你刚才说的这些之间有什么联系？',
    isFinalRound: false,
  },
  4: {
    reply: '经过这几轮讨论思考更深了。最后来做个总结：你认为这个问题最核心的启示是什么？',
    acknowledge: '经过这几轮讨论思考更深了。',
    followUpQuestion: '最后来做个总结：你认为这个问题最核心的启示是什么？',
    isFinalRound: false,
  },
  5: {
    reply: '你的总结把这次讨论的思考串起来了。',
    acknowledge: '你的总结把这次讨论的思考串起来了。',
    followUpQuestion: '',
    isFinalRound: true,
    thoughtFlow: '思考路径：观点表态 → 补充论据 → 反思检验 → 总结沉淀',
    articleScores: {
      independent_thinking: 6,
      evidence_quality: 5,
      logic_structure: 5,
      word_precision: 6,
      reflection_depth: 4,
    },
    articleComment: '本篇回答有基本观点和论据，逻辑和反思可进一步提升。',
    guideToThinkingGuide: '想看你在本阶段的整体思考能力变化，可以去测评的「思考指南」。',
  },
}

function fallbackReply(_message: string, round: number): ChatResult {
  // 超出轮次上限（>5）按总结轮兜底，保证对话能收尾
  return FALLBACK_TEMPLATES[round] ?? FALLBACK_TEMPLATES[5]
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<ChatRequest>

    const message = body.message?.trim()
    if (!message) {
      return Response.json(
        { success: false, error: '请输入你想说的内容' } satisfies ApiResponse<never>,
        { status: 400 }
      )
    }

    const articleTitle = body.articleTitle ?? ''
    const articleSummary = body.articleSummary ?? ''
    const keyPoints = body.articleKeyPoints ?? []
    const questionText = body.questionText ?? ''
    const dialogueHistory = body.dialogueHistory ?? []

    // 计算当前轮次（1-5；第 5 轮为总结轮，超出上限按第 5 轮处理保证能收尾）
    const userTurns = dialogueHistory.filter((t) => t.role === 'user').length
    const round = Math.min(userTurns + 1, 5)

    // 构建文章内容（截断到 500 字，token 控制）
    const article = truncateText(
      `${articleTitle}\n\n${articleSummary}\n\n关键要点：${keyPoints.join('；')}`,
      500
    )

    // 对话历史：初次回答作为首条上下文 + 既有对话轮次（前端传入的历史不含当前消息）
    // 「用户回答」= 当前轮用户最新发言，保证 AI 即时回应用户本轮输入（修复滞后一轮问题）
    // 注意：把当前 message 显式追加为用户最新一条，让模型把"最近一轮用户输入"当作当轮，
    // 避免模型基于历史里上一轮用户话回应造成"隔一轮"。round 计算用 body.dialogueHistory，
    // 不受这里追加影响。
    const fullHistory = [
      ...(body.firstAnswer
        ? [{ role: 'user', content: `（用户对思考题的初次回答）${body.firstAnswer}` }]
        : []),
      ...dialogueHistory,
      { role: 'user', content: message },
    ]

    // 调用 AI
    const userMessage = buildDialogueUserMessage({
      article,
      question: questionText,
      userAnswer: message,
      dialogueHistory: fullHistory,
      round,
    })

    const rawResult = await callAIForJSON<unknown>(DIALOGUE_SYSTEM_PROMPT, userMessage)

    // ===== 输出校验 =====
    const aiResult = rawResult ? validateDialogueResult(rawResult, round) : null

    // 校验失败 → 兜底
    if (!aiResult) {
      console.error('[chat] AI output validation failed, using fallback')
      const fallback = fallbackReply(message, round)
      return Response.json(
        { success: true, data: fallback } satisfies ApiResponse<ChatResult>
      )
    }

    // 校验通过 — 组装返回（总结轮 follow_up_question 为空，reply 仅含肯定语）
    const reply = aiResult.follow_up_question
      ? `${aiResult.acknowledge} ${aiResult.follow_up_question}`
      : aiResult.acknowledge
    return Response.json(
      {
        success: true,
        data: {
          reply,
          acknowledge: aiResult.acknowledge,
          followUpQuestion: aiResult.follow_up_question,
          isFinalRound: aiResult.is_final_round,
          thoughtFlow: aiResult.thought_flow || undefined,
          articleScores: aiResult.article_scores,
          articleComment: aiResult.article_comment || undefined,
          guideToThinkingGuide: aiResult.guide_to_thinking_guide || undefined,
        }
      } satisfies ApiResponse<ChatResult>
    )
  } catch (e) {
    console.error('[api/chat] error:', e)
    return Response.json(
      { success: false, error: '我这边开小差了，能再说一次吗？' } satisfies ApiResponse<never>,
      { status: 500 }
    )
  }
}
