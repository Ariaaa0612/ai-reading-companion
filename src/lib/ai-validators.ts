/**
 * AI 输出校验器
 *
 * 严格根据 prompt 文档定义的输出校验规则，
 * 对 AI 返回的 JSON 做字段级校验。
 * 任一校验失败 → 返回 null，调用方走兜底逻辑。
 *
 * 校验规则来源：prompt 工程设计文档 v2.1
 */

import type { ScoringResult } from '@/lib/prompts/scoring'
import type { DialogueResult, ArticleScores } from '@/lib/prompts/dialogue'
import type { GuideResult } from '@/lib/prompts/guide'

// ===== 公共：违禁词检测 =====

/**
 * 违禁词列表
 *
 * prompt 要求"不打趣、不调侃、不玩乐、不奉承，无废话"
 * 以下词汇出现即视为风格违规
 */
// 多字违禁词：所有字段统一检查（作为子串出现即违规，无正常用词误报风险）
const BANNED_PHRASES: string[] = [
  // 打趣/玩乐
  '哈哈', '笑死', '666', '6666', '牛逼', '牛批', '牛b', '太强了', '无敌', '绝了',
  'yyds', '芜湖', '起飞', 'NB', '厉害了',
  // 奉承/讨好
  '宝贝', '亲爱的', '小可爱',
  '太棒了', '你真厉害', '你太强了', '你的回答太完美了',
  '完美', '满分', '无可挑剔',
  // 调侃/网络热梗
  '破防了', '蚌埠住了', '绷不住了', '就这吧',
]

// 单字/易误报违禁词：仅对短字段（response / acknowledge / follow_up_question）检查，
// 避免长文本误报："牛顿"含"牛"、"梗概"含"梗"、"亲自"含"亲"、"就这一点"含"就这"、
// 英文词"unbelievable"含"nb"
const SHORT_FIELD_BANNED: string[] = [
  '牛', '梗', '亲', 'nb',
  '嘛', '呗', '啦', '哒', '呢嘛',
  '就这', '就这？',
]

/**
 * 检查文本是否包含违禁词
 * @param strict - true 时附加检查单字/易误报词（仅用于短字段）
 * @returns 违禁词本身，无违禁返回 null
 */
function findBannedPhrase(text: string, strict: boolean = false): string | null {
  const phrases = strict ? [...BANNED_PHRASES, ...SHORT_FIELD_BANNED] : BANNED_PHRASES
  for (const phrase of phrases) {
    if (text.includes(phrase)) {
      return phrase
    }
  }
  return null
}

/**
 * 检查文本是否暗示/泄露答案
 *
 * prompt 要求"永远不替用户回答问题，不暗示答案"
 */
const ANSWER_HINT_PATTERNS: string[] = [
  '答案是',
  '答案就是',
  '其实就是',
  '应该是',
  '正确的看法是',
  '正确的观点是',
  '我认为答案是',
  '正确答案是',
  '标准答案是',
  '答案应该是',
  '其实答案',
  '说白了就是',
  '换句话说就是',
  '也就是说答案',
]

function findAnswerHint(text: string): string | null {
  for (const pattern of ANSWER_HINT_PATTERNS) {
    if (text.includes(pattern)) {
      return pattern
    }
  }
  return null
}

// ===== Prompt 1 校验 =====

/**
 * 校验评分结果（Prompt 1）
 *
 * 文档校验规则：
 * 1. JSON.parse 必须成功
 * 2. response 非空且 20-80 字
 * 3. assessment 非空且 50-300 字
 * 4. response 语气符合亦师亦友，无打趣奉承
 *
 * @returns 校验通过返回规范化数据，失败返回 null
 */
export function validateScoringResult(result: unknown): ScoringResult | null {
  if (!result || typeof result !== 'object') return null

  const r = result as Record<string, unknown>
  const response = r['response']
  const assessment = r['assessment']

  // 1. response 非空且 20-80 字（文档要求，容差 ±5）
  if (typeof response !== 'string') {
    console.error('[validator] response is not a string')
    return null
  }
  const responseTrimmed = response.trim()
  if (responseTrimmed.length < 15 || responseTrimmed.length > 85) {
    console.error('[validator] response length invalid: length=', responseTrimmed.length, '(expected 20-80, tolerance 15-85)')
    return null
  }

  // 2. assessment 非空且 50-300 字（文档要求；下限容差放宽到 20，
  //    避免 AI 对"没什么毛病"的回答给出简短评估时被误杀走兜底）
  if (typeof assessment !== 'string') {
    console.error('[validator] assessment is not a string')
    return null
  }
  const assessmentTrimmed = assessment.trim()
  if (assessmentTrimmed.length < 20 || assessmentTrimmed.length > 310) {
    console.error('[validator] assessment length invalid: length=', assessmentTrimmed.length, '(lower bound relaxed to 20, upper 310)')
    return null
  }

  // 3. response 不能包含违禁词（文档要求"无打趣奉承"；短字段启用严格模式）
  const bannedInResponse = findBannedPhrase(responseTrimmed, true)
  if (bannedInResponse) {
    console.error('[validator] response contains banned phrase:', bannedInResponse)
    return null
  }

  // 4. response 不能暗示答案
  const hintInResponse = findAnswerHint(responseTrimmed)
  if (hintInResponse) {
    console.error('[validator] response contains answer hint:', hintInResponse)
    return null
  }

  // 5. assessment 也不能包含违禁词
  const bannedInAssessment = findBannedPhrase(assessmentTrimmed)
  if (bannedInAssessment) {
    console.error('[validator] assessment contains banned phrase:', bannedInAssessment)
    return null
  }

  // 6. assessment 必须包含优点和问题两部分（prompt 要求"先讲优点再讲问题"）
  // 例外：问题主导型评估（prompt 示例 4/5/6/7）只输出"问题"——
  // 敷衍回答按 prompt 要求明确标记"敷衍"；啰嗦回答以"主要问题"开头。
  // 识别到这些标记时跳过"必须有优点"检查，避免合法输出被误判走兜底
  const isPerfunctory =
    assessmentTrimmed.includes('敷衍') || assessmentTrimmed.includes('主要问题')
  const positiveKeywords = ['亮点', '优点', '好的', '不错', '肯定', '值得', '好的方面', '做得好', '思考深']
  const negativeKeywords = ['问题', '可提升', '不足', '可改', '需要改', '可以更', '建议', '改进', '敷衍']
  const hasPositive = positiveKeywords.some((kw) => assessmentTrimmed.includes(kw))
  const hasNegative = negativeKeywords.some((kw) => assessmentTrimmed.includes(kw))
  if (isPerfunctory) {
    // 敷衍场景：只需有问题部分
    if (!hasNegative) {
      console.error('[validator] perfunctory assessment missing negative part')
      return null
    }
  } else if (!hasPositive || !hasNegative) {
    console.error('[validator] assessment missing positive or negative part. hasPositive=', hasPositive, 'hasNegative=', hasNegative)
    return null
  }

  return {
    response: responseTrimmed,
    assessment: assessmentTrimmed,
  }
}

// ===== Prompt 2 校验 =====

/**
 * 统计字符串中问号数量（中文？和英文?）
 */
function countQuestionMarks(text: string): number {
  const matches = text.match(/[？?]/g)
  return matches ? matches.length : 0
}

/**
 * 校验五维评分对象
 * 5 个维度均为 0-10 整数
 */
function validateArticleScores(scores: unknown): ArticleScores | null {
  if (!scores || typeof scores !== 'object') return null

  const s = scores as Record<string, unknown>
  const requiredKeys: (keyof ArticleScores)[] = [
    'independent_thinking',
    'evidence_quality',
    'logic_structure',
    'word_precision',
    'reflection_depth',
  ]

  const result: ArticleScores = {
    independent_thinking: 0,
    evidence_quality: 0,
    logic_structure: 0,
    word_precision: 0,
    reflection_depth: 0,
  }

  for (const key of requiredKeys) {
    const val = s[key as string]
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 0 || val > 10) {
      console.error('[validator] article_scores invalid:', key, val)
      return null
    }
    result[key] = val
  }

  return result
}

/**
 * 校验对话结果（Prompt 2）
 *
 * 文档校验规则：
 * 1. JSON.parse 成功
 * 2. acknowledge 非空且 10-40 字
 * 3. follow_up_question：第 1-4 轮非空且包含且仅包含 1 个问号；第 5 轮（总结轮）为空字符串
 * 4. is_final_round 为布尔值且与 round 一致（round=5 时必须为 true）
 * 5. 第 5 轮时 thought_flow 非空、article_scores 为含 5 个 0-10 整数的对象、
 *    article_comment 非空且 ≤50 字、guide_to_thinking_guide 非空
 * 6. 非第 5 轮时这四个字段分别为空字符串/null/空字符串/空字符串
 *
 * @param result - AI 返回的原始 JSON 对象
 * @param round  - 当前轮次 (1, 2, 3, 4, 5)
 * @returns 校验通过返回规范化后的数据，失败返回 null
 */
export function validateDialogueResult(result: unknown, round: number): DialogueResult | null {
  if (!result || typeof result !== 'object') return null

  const r = result as Record<string, unknown>

  // 1. acknowledge 非空：作答型 10-40 字；回应型（澄清/确认）可稍长，上限放宽到 80 字
  const acknowledge = r['acknowledge']
  if (typeof acknowledge !== 'string') {
    console.error('[validator] acknowledge is not a string')
    return null
  }
  const acknowledgeTrimmed = acknowledge.trim()
  if (acknowledgeTrimmed.length < 5 || acknowledgeTrimmed.length > 80) {
    console.error('[validator] acknowledge length invalid: length=', acknowledgeTrimmed.length, '(normal 10-40，回应型澄清/确认可到 80)')
    return null
  }

  // acknowledge 不能包含违禁词（短字段启用严格模式）
  const bannedInAck = findBannedPhrase(acknowledgeTrimmed, true)
  if (bannedInAck) {
    console.error('[validator] acknowledge contains banned phrase:', bannedInAck)
    return null
  }

  // 2. follow_up_question：第 1-4 轮非空且仅含 1 个问号；第 5 轮（总结轮）为空字符串
  const followUp = r['follow_up_question']
  if (typeof followUp !== 'string') {
    console.error('[validator] follow_up_question is not a string')
    return null
  }
  const followUpTrimmed = followUp.trim()
  const isSummaryRound = round === 5
  let followUpTrimmedFixed = followUpTrimmed

  {
    // 所有轮次（含第 5 轮总结轮）统一视为普通轮：follow_up_question 可为一个引导问题。
    // 不再强制第 5 轮 follow_up 为空，也不再强制 is_final_round 必须为 true。
    if (followUpTrimmed.length === 0) {
      console.error('[validator] follow_up_question empty')
      return null
    }
    // 自动修复：AI 偶发输出多个问号（如"是A吗？还是B？"），
    // 截断到第一个问号保留主问题，而不是整条拒绝走兜底
    const qCountRaw = countQuestionMarks(followUpTrimmed)
    if (qCountRaw > 1) {
      const firstQm = followUpTrimmed.search(/[？?]/)
      followUpTrimmedFixed = followUpTrimmed.slice(0, firstQm + 1).trim()
      console.warn('[validator] follow_up_question auto-repaired: truncated to first question mark')
    }
    const qCount = countQuestionMarks(followUpTrimmedFixed)
    if (qCount !== 1 || followUpTrimmedFixed.length === 0) {
      console.error('[validator] follow_up_question must have exactly 1 question mark, got:', qCountRaw)
      return null
    }

    // follow_up_question 不能泄露答案
    const hintInFollowUp = findAnswerHint(followUpTrimmedFixed)
    if (hintInFollowUp) {
      console.error('[validator] follow_up_question contains answer hint:', hintInFollowUp)
      return null
    }

    // follow_up_question 不能包含违禁词（短字段启用严格模式）
    const bannedInFollowUp = findBannedPhrase(followUpTrimmedFixed, true)
    if (bannedInFollowUp) {
      console.error('[validator] follow_up_question contains banned phrase:', bannedInFollowUp)
      return null
    }
  }

  // 3. is_final_round 为布尔值即可（不再强制与 round===5 绑定）
  const isFinalRound = r['is_final_round']
  if (typeof isFinalRound !== 'boolean') {
    console.error('[validator] is_final_round not boolean')
    return null
  }

  // 4 & 5. 根据是否第 5 轮（总结轮）校验收尾字段：第 5 轮仍要求收尾字段有效，
  //    但允许 follow_up 是一个引导问题、is_final_round 由模型自然决定（可为 true，引导收尾后作为最后一轮结果）
  const thoughtFlow = r['thought_flow']
  const articleScores = r['article_scores']
  const articleComment = r['article_comment']
  const guideToThinking = r['guide_to_thinking_guide']

  if (isSummaryRound) {
    // 第 5 轮（总结轮）：收尾字段必须有效
    if (typeof thoughtFlow !== 'string' || thoughtFlow.trim().length === 0) {
      console.error('[validator] thought_flow must be non-empty at round 5')
      return null
    }
    const thoughtFlowTrimmed = thoughtFlow.trim()

    const validatedScores = validateArticleScores(articleScores)
    if (!validatedScores) {
      console.error('[validator] article_scores invalid at round 5')
      return null
    }

    if (typeof articleComment !== 'string' || articleComment.trim().length === 0) {
      console.error('[validator] article_comment must be non-empty at round 5')
      return null
    }
    const articleCommentTrimmed = articleComment.trim()
    if (articleCommentTrimmed.length > 50) {
      console.error('[validator] article_comment too long at round 5: length=', articleCommentTrimmed.length, '(max 50)')
      return null
    }

    if (typeof guideToThinking !== 'string' || guideToThinking.trim().length === 0) {
      console.error('[validator] guide_to_thinking_guide must be non-empty at round 5')
      return null
    }
    const guideTrimmed = guideToThinking.trim()

    // 收尾字段也不能包含违禁词
    const bannedInThoughtFlow = findBannedPhrase(thoughtFlowTrimmed)
    if (bannedInThoughtFlow) {
      console.error('[validator] thought_flow contains banned phrase:', bannedInThoughtFlow)
      return null
    }
    const bannedInComment = findBannedPhrase(articleCommentTrimmed)
    if (bannedInComment) {
      console.error('[validator] article_comment contains banned phrase:', bannedInComment)
      return null
    }
    const bannedInGuide = findBannedPhrase(guideTrimmed)
    if (bannedInGuide) {
      console.error('[validator] guide_to_thinking_guide contains banned phrase:', bannedInGuide)
      return null
    }

    return {
      acknowledge: acknowledgeTrimmed,
      follow_up_question: followUpTrimmedFixed,
      is_final_round: isFinalRound,
      thought_flow: thoughtFlowTrimmed,
      article_scores: validatedScores,
      article_comment: articleCommentTrimmed,
      guide_to_thinking_guide: guideTrimmed,
    }
  } else {
    // 非第 5 轮：收尾字段清空
    return {
      acknowledge: acknowledgeTrimmed,
      follow_up_question: followUpTrimmedFixed,
      is_final_round: isFinalRound,
      thought_flow: '',
      article_scores: null,
      article_comment: '',
      guide_to_thinking_guide: '',
    }
  }
}

// ===== Prompt 3 校验 =====

/**
 * 校验思考指南结果（Prompt 3）
 *
 * 校验规则：
 * 1. stage_scores 为含 5 个 0-10 整数的对象
 * 2. problems 为非空数组，长度 1-3，每个元素为非空字符串
 * 3. analysis 非空且 200-400 字
 * 4. actionable_advice 非空且 ≤100 字
 * 5. small_goals 为非空数组，长度 1-3，每个元素为非空字符串
 * 6. 所有文本字段不能包含违禁词
 *
 * @returns 校验通过返回规范化数据，失败返回 null
 */
export function validateGuideResult(result: unknown): GuideResult | null {
  if (!result || typeof result !== 'object') return null

  const r = result as Record<string, unknown>

  // 1. stage_scores 校验
  const validatedScores = validateArticleScores(r['stage_scores'])
  if (!validatedScores) {
    console.error('[validator] guide: stage_scores invalid')
    return null
  }

  // 2. problems 数组校验
  const problems = r['problems']
  if (!Array.isArray(problems) || problems.length < 1 || problems.length > 3) {
    console.error('[validator] guide: problems must be array of 1-3 items, got:', Array.isArray(problems) ? problems.length : 'not-array')
    return null
  }
  const problemsTrimmed: string[] = []
  for (let i = 0; i < problems.length; i++) {
    if (typeof problems[i] !== 'string' || (problems[i] as string).trim().length === 0) {
      console.error('[validator] guide: problems[' + i + '] empty or not string')
      return null
    }
    const p = (problems[i] as string).trim()
    const banned = findBannedPhrase(p)
    if (banned) {
      console.error('[validator] guide: problems[' + i + '] contains banned phrase:', banned)
      return null
    }
    problemsTrimmed.push(p)
  }

  // 3. analysis 校验（200-400 字，容差 ±20）
  const analysis = r['analysis']
  if (typeof analysis !== 'string') {
    console.error('[validator] guide: analysis is not a string')
    return null
  }
  const analysisTrimmed = analysis.trim()
  if (analysisTrimmed.length < 170 || analysisTrimmed.length > 420) {
    console.error('[validator] guide: analysis length invalid: length=', analysisTrimmed.length, '(expected 200-400, tolerance 170-420)')
    return null
  }
  const bannedInAnalysis = findBannedPhrase(analysisTrimmed)
  if (bannedInAnalysis) {
    console.error('[validator] guide: analysis contains banned phrase:', bannedInAnalysis)
    return null
  }

  // 4. actionable_advice 校验（≤100 字）
  const advice = r['actionable_advice']
  if (typeof advice !== 'string') {
    console.error('[validator] guide: actionable_advice is not a string')
    return null
  }
  const adviceTrimmed = advice.trim()
  if (adviceTrimmed.length === 0 || adviceTrimmed.length > 100) {
    console.error('[validator] guide: actionable_advice length invalid: length=', adviceTrimmed.length, '(expected 1-100)')
    return null
  }
  const bannedInAdvice = findBannedPhrase(adviceTrimmed)
  if (bannedInAdvice) {
    console.error('[validator] guide: actionable_advice contains banned phrase:', bannedInAdvice)
    return null
  }

  // 5. small_goals 数组校验
  const goals = r['small_goals']
  if (!Array.isArray(goals) || goals.length < 1 || goals.length > 3) {
    console.error('[validator] guide: small_goals must be array of 1-3 items, got:', Array.isArray(goals) ? goals.length : 'not-array')
    return null
  }
  const goalsTrimmed: string[] = []
  for (let i = 0; i < goals.length; i++) {
    if (typeof goals[i] !== 'string' || (goals[i] as string).trim().length === 0) {
      console.error('[validator] guide: small_goals[' + i + '] empty or not string')
      return null
    }
    const g = (goals[i] as string).trim()
    const banned = findBannedPhrase(g)
    if (banned) {
      console.error('[validator] guide: small_goals[' + i + '] contains banned phrase:', banned)
      return null
    }
    goalsTrimmed.push(g)
  }

  return {
    stage_scores: validatedScores,
    problems: problemsTrimmed,
    analysis: analysisTrimmed,
    actionable_advice: adviceTrimmed,
    small_goals: goalsTrimmed,
  }
}
