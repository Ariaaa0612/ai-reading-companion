/**
 * 存储层 —— Supabase 云端存储 + localStorage 本地缓存
 *
 * 策略：写操作同时写 Supabase 和 localStorage（双写）
 *       读操作优先读 localStorage（同步），异步从 Supabase 刷新
 *       这样页面代码无需改为 async，同时数据持久化到云端
 *
 * 生产环境如需改为纯 Supabase 异步读取，只需将同步读函数改为 async 即可。
 */

import type {
  UserPlan,
  ReadingRecord,
  QuizAnswer,
  ChatMessage,
  Assessment,
  DialogueTurn,
  ThinkingDimension,
  FinalScores,
} from '@/types'
import { supabase, getCurrentUserId } from '@/lib/supabase'

/**
 * 单条回答的综合分（用于测评/薄弱维度统计）
 * 优先取最后一轮收尾五维评分的均值；无收尾评分时退回 aiScore（>0 才有效）
 * @returns null 表示该回答尚无有效分数（不应计入统计）
 */
export function getAnswerOverallScore(a: QuizAnswer): number | null {
  if (a.finalScores) {
    const s = a.finalScores
    return (s.independent_thinking + s.evidence_quality + s.logic_structure + s.word_precision + s.reflection_depth) / 5
  }
  if (a.aiScore > 0) return a.aiScore
  return null
}

/**
 * Supabase 调用安全包装器
 * 浏览器端 RLS 可能阻止写操作，静默失败，不影响 localStorage 主存储
 */
async function safeSupa<T>(fn: () => PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<{ data: T | null; error: unknown }> {
  try {
    const result = await fn()
    if (result.error) {
      console.warn('[storage] Supabase non-critical error:', result.error.message)
      return { data: null, error: result.error }
    }
    return result
  } catch (e) {
    console.warn('[storage] Supabase call failed (non-critical):', e)
    return { data: null, error: e }
  }
}

const STORAGE_KEYS = {
  USER_PLAN: 'arc_user_plan',
  READING_RECORDS: 'arc_reading_records',
  QUIZ_ANSWERS: 'arc_quiz_answers',
  CHAT_MESSAGES: 'arc_chat_messages',
  ASSESSMENTS: 'arc_assessments',
  USER_ID: 'arc_user_id',
  WEAK_DIMENSION: 'arc_weak_dimension',
} as const

// ===== 工具函数 =====

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function getUserId(): string {
  if (typeof window === 'undefined') return 'server-side'
  // 优先从 supabase 登录获取
  const supaId = getCurrentUserId()
  if (supaId) return supaId
  // 兼容旧数据
  let userId = localStorage.getItem(STORAGE_KEYS.USER_ID)
  if (!userId) {
    userId = generateId()
    localStorage.setItem(STORAGE_KEYS.USER_ID, userId)
  }
  return userId
}

function readArray<T>(key: string): T[] {
  if (typeof window === 'undefined') return []
  const raw = localStorage.getItem(key)
  if (!raw) return []
  try {
    return JSON.parse(raw) as T[]
  } catch {
    return []
  }
}

function writeArray<T>(key: string, data: T[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(key, JSON.stringify(data))
}

// ===== 用户计划 =====

export const planStorage = {
  get(): UserPlan | null {
    const plans = readArray<UserPlan>(STORAGE_KEYS.USER_PLAN)
    return plans.length > 0 ? plans[0] : null
  },

  async save(plan: Omit<UserPlan, 'id' | 'userId' | 'createdAt' | 'updatedAt'>): Promise<UserPlan> {
    const existing = this.get()
    const now = new Date().toISOString()
    const userId = getUserId()

    let saved: UserPlan

    if (existing) {
      saved = { ...existing, ...plan, updatedAt: now }
      writeArray(STORAGE_KEYS.USER_PLAN, [saved])

      // 更新 Supabase（非关键，失败不影响）
      await safeSupa(() => supabase.from('user_plans').update({
        daily_goal: plan.dailyGoal,
        weekdays: plan.weekdays,
        reminder_time: plan.reminderTime,
        updated_at: now,
      }).eq('user_id', userId).then(r => ({ data: r.data, error: r.error as { message: string } | null })))
    } else {
      saved = {
        id: generateId(),
        userId,
        ...plan,
        createdAt: now,
        updatedAt: now,
      }
      writeArray(STORAGE_KEYS.USER_PLAN, [saved])

      // 插入 Supabase（非关键）
      await safeSupa(() => supabase.from('user_plans').insert({
        user_id: userId,
        daily_goal: plan.dailyGoal,
        weekdays: plan.weekdays,
        reminder_time: plan.reminderTime,
      }).then(r => ({ data: r.data, error: r.error as { message: string } | null })))
    }

    return saved
  },

  /** 从 Supabase 拉取最新计划 */
  async syncFromCloud(): Promise<void> {
    try {
      const userId = getUserId()
      const { data } = await supabase
        .from('user_plans')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()

      if (data) {
        const plan: UserPlan = {
          id: data.id,
          userId: data.user_id,
          dailyGoal: data.daily_goal,
          weekdays: data.weekdays,
          reminderTime: data.reminder_time,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        }
        writeArray(STORAGE_KEYS.USER_PLAN, [plan])
      }
    } catch (e) {
      console.warn('[storage] planSyncFromCloud failed (non-critical):', e)
    }
  },
}

// ===== 阅读记录（打卡） =====

export const recordStorage = {
  list(): ReadingRecord[] {
    return readArray<ReadingRecord>(STORAGE_KEYS.READING_RECORDS)
  },

  listByDate(date: string): ReadingRecord[] {
    return this.list().filter((r) => r.date === date)
  },

  getByArticle(articleId: string): ReadingRecord | null {
    return this.list().find((r) => r.articleId === articleId) ?? null
  },

  /** 自动打卡 */
  async autoCheckIn(articleId: string, articleTitle: string): Promise<ReadingRecord> {
    const records = this.list()
    const existing = records.find((r) => r.articleId === articleId)
    const now = new Date().toISOString()
    const today = now.slice(0, 10)
    const userId = getUserId()

    let record: ReadingRecord

    if (existing) {
      existing.status = 'completed'
      existing.updatedAt = now
      record = existing
      writeArray(STORAGE_KEYS.READING_RECORDS, records)

      await safeSupa(() => supabase.from('reading_records').update({
        status: 'completed',
        updated_at: now,
      }).eq('user_id', userId).eq('article_id', articleId).then(r => ({ data: r.data, error: r.error as { message: string } | null })))
    } else {
      record = {
        id: generateId(),
        userId,
        articleId,
        articleTitle,
        date: today,
        status: 'completed',
        readingTimeSeconds: 0,
        createdAt: now,
        updatedAt: now,
      }
      records.push(record)
      writeArray(STORAGE_KEYS.READING_RECORDS, records)

      await safeSupa(() => supabase.from('reading_records').insert({
        user_id: userId,
        article_id: articleId,
        article_title: articleTitle,
        date: today,
        status: 'completed',
        reading_time_seconds: 0,
      }).then(r => ({ data: r.data, error: r.error as { message: string } | null })))
    }

    return record
  },

  /** 获取连续打卡天数 */
  getStreakDays(): number {
    const records = this.list()
    const dates = new Set(records.map((r) => r.date))
    let streak = 0
    const today = new Date()
    for (let i = 0; i < 365; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().slice(0, 10)
      if (dates.has(dateStr)) {
        streak++
      } else if (i > 0) {
        break
      }
    }
    return streak
  },

  listByDateRange(startDate: string, endDate: string): ReadingRecord[] {
    return this.list().filter((r) => r.date >= startDate && r.date <= endDate)
  },

  isCheckedInToday(): boolean {
    const today = new Date().toISOString().slice(0, 10)
    return this.list().some((r) => r.date === today && r.status === 'completed')
  },

  /** 从 Supabase 同步所有打卡记录 */
  async syncFromCloud(): Promise<void> {
    try {
      const userId = getUserId()
      const { data } = await supabase
        .from('reading_records')
        .select('*')
        .eq('user_id', userId)

      if (data) {
        const records: ReadingRecord[] = data.map((r) => ({
          id: r.id,
          userId: r.user_id,
          articleId: r.article_id,
          articleTitle: r.article_title,
          date: r.date,
          status: r.status,
          readingTimeSeconds: r.reading_time_seconds,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }))
        writeArray(STORAGE_KEYS.READING_RECORDS, records)
      }
    } catch (e) {
      console.warn('[storage] recordSyncFromCloud failed (non-critical):', e)
    }
  },
}

// ===== 思考题回答（含对话轮次） =====

export const quizStorage = {
  list(): QuizAnswer[] {
    return readArray<QuizAnswer>(STORAGE_KEYS.QUIZ_ANSWERS)
  },

  getByArticle(articleId: string): QuizAnswer[] {
    return this.list().filter((a) => a.articleId === articleId)
  },

  getByQuestion(articleId: string, questionId: string): QuizAnswer | null {
    return this.list().find(
      (a) => a.articleId === articleId && a.questionId === questionId
    ) ?? null
  },

  /** 保存第一次回答 */
  async saveInitial(answer: {
    articleId: string
    questionId: string
    questionText: string
    dimension: QuizAnswer['dimension']
    userAnswer: string
    aiAnalysis: string
    aiScore: number
  }): Promise<QuizAnswer> {
    const answers = this.list()
    const existing = answers.find(
      (a) => a.articleId === answer.articleId && a.questionId === answer.questionId
    )
    const userId = getUserId()
    const now = new Date().toISOString()

    let saved: QuizAnswer

    if (existing) {
      existing.userAnswer = answer.userAnswer
      existing.aiAnalysis = answer.aiAnalysis
      existing.aiScore = answer.aiScore
      saved = existing
      writeArray(STORAGE_KEYS.QUIZ_ANSWERS, answers)

      await safeSupa(() => supabase.from('quiz_answers').update({
        user_answer: answer.userAnswer,
        ai_analysis: answer.aiAnalysis,
        ai_score: answer.aiScore,
      }).eq('user_id', userId).eq('article_id', answer.articleId).eq('question_id', answer.questionId).then(r => ({ data: r.data, error: r.error as { message: string } | null })))
    } else {
      saved = {
        id: generateId(),
        userId,
        articleId: answer.articleId,
        questionId: answer.questionId,
        questionText: answer.questionText,
        dimension: answer.dimension,
        userAnswer: answer.userAnswer,
        aiAnalysis: answer.aiAnalysis,
        aiScore: answer.aiScore,
        dialogueTurns: [],
        completed: false,
        createdAt: now,
        completedAt: null,
      }
      answers.push(saved)
      writeArray(STORAGE_KEYS.QUIZ_ANSWERS, answers)

      await safeSupa(() => supabase.from('quiz_answers').insert({
        user_id: userId,
        article_id: answer.articleId,
        question_id: answer.questionId,
        question_text: answer.questionText,
        dimension: answer.dimension,
        user_answer: answer.userAnswer,
        ai_analysis: answer.aiAnalysis,
        ai_score: answer.aiScore,
        dialogue_turns: [],
        completed: false,
      }).then(r => ({ data: r.data, error: r.error as { message: string } | null })))
    }

    return saved
  },

  /** 添加一轮对话 */
  async addDialogueTurn(articleId: string, questionId: string, turn: Omit<DialogueTurn, 'createdAt'>): Promise<void> {
    const answers = this.list()
    const existing = answers.find(
      (a) => a.articleId === articleId && a.questionId === questionId
    )
    if (!existing) return

    const newTurn: DialogueTurn = { ...turn, createdAt: new Date().toISOString() }
    existing.dialogueTurns.push(newTurn)
    writeArray(STORAGE_KEYS.QUIZ_ANSWERS, answers)

    // 更新 Supabase 中的 dialogue_turns（非关键）
    await safeSupa(() => supabase.from('quiz_answers').update({
      dialogue_turns: existing.dialogueTurns,
    }).eq('user_id', getUserId()).eq('article_id', articleId).eq('question_id', questionId).then(r => ({ data: r.data, error: r.error as { message: string } | null })))
  },

  /** 获取对话轮次 */
  getDialogueTurns(articleId: string, questionId: string): DialogueTurn[] {
    const answer = this.getByQuestion(articleId, questionId)
    return answer?.dialogueTurns ?? []
  },

  /** 保存最后一轮收尾结果（五维评分 + 总评 + 思考流程图） */
  async saveFinalScores(articleId: string, questionId: string, payload: {
    finalScores: FinalScores
    finalComment: string
    thoughtFlow: string
  }): Promise<void> {
    const answers = this.list()
    const existing = answers.find(
      (a) => a.articleId === articleId && a.questionId === questionId
    )
    if (!existing) return

    existing.finalScores = payload.finalScores
    existing.finalComment = payload.finalComment
    existing.thoughtFlow = payload.thoughtFlow
    writeArray(STORAGE_KEYS.QUIZ_ANSWERS, answers)

    // 云端需先执行 supabase-schema.sql 中的 ALTER TABLE 增加 final_scores 等列；
    // 未执行前此调用会静默失败（非关键），localStorage 为主存储
    await safeSupa(() => supabase.from('quiz_answers').update({
      final_scores: payload.finalScores,
      final_comment: payload.finalComment,
      thought_flow: payload.thoughtFlow,
    }).eq('user_id', getUserId()).eq('article_id', articleId).eq('question_id', questionId).then(r => ({ data: r.data, error: r.error as { message: string } | null })))
  },

  /** 标记该题已完成 */
  async markCompleted(articleId: string, questionId: string): Promise<void> {
    const answers = this.list()
    const existing = answers.find(
      (a) => a.articleId === articleId && a.questionId === questionId
    )
    if (!existing) return

    existing.completed = true
    existing.completedAt = new Date().toISOString()
    writeArray(STORAGE_KEYS.QUIZ_ANSWERS, answers)

    await safeSupa(() => supabase.from('quiz_answers').update({
      completed: true,
      completed_at: existing.completedAt,
    }).eq('user_id', getUserId()).eq('article_id', articleId).eq('question_id', questionId).then(r => ({ data: r.data, error: r.error as { message: string } | null })))
  },

  /** 检查一篇文章的所有思考题是否都已完成 */
  areAllQuestionsCompleted(articleId: string, totalQuestions: number): boolean {
    const answers = this.getByArticle(articleId).filter((a) => a.completed)
    return answers.length >= totalQuestions
  },

  /** 获取指定维度所有已完成的回答 */
  listByDimension(dimension: string): QuizAnswer[] {
    return this.list().filter((a) => a.dimension === dimension && a.completed)
  },

  /** 获取最近 N 天的回答 */
  listRecent(days: number): QuizAnswer[] {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffStr = cutoff.toISOString()
    return this.list().filter((a) => a.createdAt >= cutoffStr)
  },

  /** 从 Supabase 同步所有回答 */
  async syncFromCloud(): Promise<void> {
    try {
      const userId = getUserId()
      const { data } = await supabase
        .from('quiz_answers')
        .select('*')
        .eq('user_id', userId)

      if (data) {
        const answers: QuizAnswer[] = data.map((r) => ({
          id: r.id,
          userId: r.user_id,
          articleId: r.article_id,
          questionId: r.question_id,
          questionText: r.question_text,
          dimension: r.dimension,
          userAnswer: r.user_answer,
          aiAnalysis: r.ai_analysis,
          aiScore: r.ai_score,
          finalScores: r.final_scores ?? null,
          finalComment: r.final_comment ?? undefined,
          thoughtFlow: r.thought_flow ?? undefined,
          dialogueTurns: r.dialogue_turns ?? [],
          completed: r.completed,
          createdAt: r.created_at,
          completedAt: r.completed_at,
        }))
        writeArray(STORAGE_KEYS.QUIZ_ANSWERS, answers)
      }
    } catch (e) {
      console.warn('[storage] quizSyncFromCloud failed (non-critical):', e)
    }
  },
}

// ===== 对话记录 =====

export const chatStorage = {
  list(articleId: string | null = null): ChatMessage[] {
    const all = readArray<ChatMessage>(STORAGE_KEYS.CHAT_MESSAGES)
    if (articleId !== null) {
      return all.filter((m) => m.articleId === articleId)
    }
    return all
  },

  async save(role: 'user' | 'assistant', content: string, articleId: string | null = null): Promise<ChatMessage> {
    const messages = this.list()
    const userId = getUserId()
    const now = new Date().toISOString()

    const newMessage: ChatMessage = {
      id: generateId(),
      userId,
      articleId,
      role,
      content,
      createdAt: now,
    }
    messages.push(newMessage)
    writeArray(STORAGE_KEYS.CHAT_MESSAGES, messages)

    await safeSupa(() => supabase.from('chat_messages').insert({
      user_id: userId,
      article_id: articleId,
      role,
      content,
    }).then(r => ({ data: r.data, error: r.error as { message: string } | null })))

    return newMessage
  },

  clear(articleId: string | null = null): void {
    if (articleId !== null) {
      const messages = this.list().filter((m) => m.articleId !== articleId)
      writeArray(STORAGE_KEYS.CHAT_MESSAGES, messages)
    } else {
      writeArray(STORAGE_KEYS.CHAT_MESSAGES, [])
    }
  },
}

// ===== 测评结果 =====

export const assessmentStorage = {
  list(): Assessment[] {
    return readArray<Assessment>(STORAGE_KEYS.ASSESSMENTS)
  },

  getLatest(): Assessment | null {
    const all = this.list()
    if (all.length === 0) return null
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  },

  async save(assessment: Omit<Assessment, 'id' | 'userId' | 'createdAt'>): Promise<Assessment> {
    const all = this.list()
    const userId = getUserId()
    const now = new Date().toISOString()

    const newAssessment: Assessment = {
      id: generateId(),
      userId,
      ...assessment,
      createdAt: now,
    }
    all.push(newAssessment)
    writeArray(STORAGE_KEYS.ASSESSMENTS, all)

    await safeSupa(() => supabase.from('assessments').insert({
      user_id: userId,
      date: assessment.date,
      dimension_scores: assessment.dimensionScores,
      summary: assessment.summary,
      day_count: assessment.dayCount,
    }).then(r => ({ data: r.data, error: r.error as { message: string } | null })))

    return newAssessment
  },

  /** 获取使用天数 */
  getUsageDays(): number {
    const records = recordStorage.list()
    if (records.length === 0) return 0
    const dates = new Set(records.map((r) => r.date))
    return dates.size
  },

  // ===== 薄弱维度追踪 =====

  getWeakDimension(): { dimension: ThinkingDimension; baselineScore: number; setAt: string } | null {
    if (typeof window === 'undefined') return null
    const raw = localStorage.getItem(STORAGE_KEYS.WEAK_DIMENSION)
    if (!raw) return null
    try {
      return JSON.parse(raw) as { dimension: ThinkingDimension; baselineScore: number; setAt: string }
    } catch {
      return null
    }
  },

  async setWeakDimension(dimension: ThinkingDimension, baselineScore: number): Promise<void> {
    if (typeof window === 'undefined') return
    const data = { dimension, baselineScore, setAt: new Date().toISOString() }
    localStorage.setItem(STORAGE_KEYS.WEAK_DIMENSION, JSON.stringify(data))

    // 写入 Supabase（upsert，非关键）
    const userId = getUserId()
    await safeSupa(() => supabase.from('weak_dimensions')
      .delete()
      .eq('user_id', userId)
      .then(r => ({ data: r.data, error: r.error as { message: string } | null })))

    await safeSupa(() => supabase.from('weak_dimensions').insert({
      user_id: userId,
      dimension,
      baseline_score: baselineScore,
    }).then(r => ({ data: r.data, error: r.error as { message: string } | null })))
  },

  hasWeakDimensionImproved(): boolean {
    const weakInfo = this.getWeakDimension()
    if (!weakInfo) return false

    const answers = quizStorage.listByDimension(weakInfo.dimension)
    const recentAnswers = answers.filter((a) => a.createdAt > weakInfo.setAt)

    if (recentAnswers.length === 0) return false

    // 只统计有有效分数的回答（五维收尾评分或 aiScore > 0）
    const scores = recentAnswers
      .map((a) => getAnswerOverallScore(a))
      .filter((s): s is number => s !== null)
    if (scores.length === 0) return false

    const recentAvg = scores.reduce((sum, s) => sum + s, 0) / scores.length
    return recentAvg >= weakInfo.baselineScore + 1
  },
}

// ===== 全局同步：页面加载时从云端拉取最新数据 =====

// ===== 合并工具：以云端为权威补齐本地缺失项，本地已有则保留本地（去重合并） =====

function mergeByIdentity<T extends { id?: string }>(localArr: T[], cloudArr: T[], identity: (item: T) => string): T[] {
  const localMap = new Map<string, T>()
  for (const item of localArr) {
    const key = identity(item)
    if (key && !localMap.has(key)) localMap.set(key, item)
  }
  for (const item of cloudArr) {
    const key = identity(item)
    if (key && !localMap.has(key)) localMap.set(key, item)
  }
  return Array.from(localMap.values())
}

export async function syncAllFromCloud(): Promise<void> {
  // 无登录态或 SSR 时跳过
  const userId = getCurrentUserId()
  if (!userId || userId === 'server-side') return

  try {
    // 1) 用户计划：云端有则覆盖本地（计划是单条）
    await planStorage.syncFromCloud()

    // 2) 阅读记录：按 (articleId) 去重合并
    const { data: records } = await safeSupa(() => supabase
      .from('reading_records')
      .select('*')
      .eq('user_id', userId)
      .then((r) => ({ data: r.data, error: r.error as { message: string } | null })))
    if (records && records.length > 0) {
      const localRecords = recordStorage.list()
      const cloudRecords: ReadingRecord[] = records.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        articleId: r.article_id,
        articleTitle: r.article_title,
        date: r.date,
        status: r.status,
        readingTimeSeconds: r.reading_time_seconds ?? 0,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))
      const merged = mergeByIdentity(localRecords, cloudRecords, (r) => r.articleId)
      writeArray(STORAGE_KEYS.READING_RECORDS, merged)
    }

    // 3) 思考题回答：按 (articleId + questionId) 去重合并
    const { data: answers } = await safeSupa(() => supabase
      .from('quiz_answers')
      .select('*')
      .eq('user_id', userId)
      .then((r) => ({ data: r.data, error: r.error as { message: string } | null })))
    if (answers && answers.length > 0) {
      const localAnswers = quizStorage.list()
      const cloudAnswers: QuizAnswer[] = answers.map((a: any) => ({
        id: a.id,
        userId: a.user_id,
        articleId: a.article_id,
        questionId: a.question_id,
        questionText: a.question_text,
        dimension: a.dimension,
        userAnswer: a.user_answer,
        aiAnalysis: a.ai_analysis,
        aiScore: a.ai_score,
        dialogueTurns: a.dialogue_turns ?? [],
        completed: a.completed ?? false,
        createdAt: a.created_at,
        completedAt: a.completed_at,
        finalScores: a.final_scores,
        finalComment: a.final_comment,
        thoughtFlow: a.thought_flow,
      }))
      const merged = mergeByIdentity(localAnswers, cloudAnswers, (a) => `${a.articleId}_${a.questionId}`)
      writeArray(STORAGE_KEYS.QUIZ_ANSWERS, merged)
    }

    // 4) 对话消息：按 id 去重合并
    const { data: messages } = await safeSupa(() => supabase
      .from('chat_messages')
      .select('*')
      .eq('user_id', userId)
      .then((r) => ({ data: r.data, error: r.error as { message: string } | null })))
    if (messages && messages.length > 0) {
      const localMessages = chatStorage.list()
      const cloudMessages: ChatMessage[] = messages.map((m: any) => ({
        id: m.id,
        userId: m.user_id,
        articleId: m.article_id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at,
      }))
      const merged = mergeByIdentity(localMessages, cloudMessages, (m) => m.id)
      writeArray(STORAGE_KEYS.CHAT_MESSAGES, merged)
    }

    // 5) 测评结果：按 id 去重合并
    const { data: assessments } = await safeSupa(() => supabase
      .from('assessments')
      .select('*')
      .eq('user_id', userId)
      .then((r) => ({ data: r.data, error: r.error as { message: string } | null })))
    if (assessments && assessments.length > 0) {
      const localAssessments = assessmentStorage.list()
      const cloudAssessments: Assessment[] = assessments.map((a: any) => ({
        id: a.id,
        userId: a.user_id,
        date: a.date,
        dimensionScores: a.dimension_scores,
        summary: a.summary,
        dayCount: a.day_count,
        createdAt: a.created_at,
      }))
      const merged = mergeByIdentity(localAssessments, cloudAssessments, (a) => a.id)
      writeArray(STORAGE_KEYS.ASSESSMENTS, merged)
    }

    // 6) 薄弱维度：云端有则覆盖本地（单条）
    const { data: weak } = await safeSupa(() => supabase
      .from('weak_dimensions')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
      .then((r) => ({ data: r.data, error: r.error as { message: string } | null })))
    if (weak) {
      localStorage.setItem(STORAGE_KEYS.WEAK_DIMENSION, JSON.stringify({
        dimension: weak.dimension,
        baselineScore: weak.baseline_score,
        setAt: weak.set_at,
      }))
    }
  } catch (e) {
    console.warn('[storage] syncAllFromCloud failed (non-critical):', e)
  }
}
