// ===== 文章相关类型 =====

export type Difficulty = '入门' | '进阶' | '深度'
export type ThinkingDimension = '理解力' | '批判性思维' | '联想力' | '表达力' | '反思力'

export interface ThinkingQuestion {
  id: string
  question: string
  type: ThinkingDimension
  hint: string
}

export interface Article {
  id: string
  title: string
  summary: string
  keyPoints: string[]
  source: string
  sourceUrl: string
  tags: string[]
  readingTime: number
  difficulty: Difficulty
  thinkingQuestions: ThinkingQuestion[]
}

export interface DailyArticles {
  date: string
  articles: Article[]
  trendCommentary: string
}

// ===== 用户数据类型 =====

export interface UserPlan {
  id: string
  userId: string
  dailyGoal: number // 每日目标阅读篇数
  weekdays: number[] // 每周哪几天阅读（0-6，0=周日）
  reminderTime?: string // 提醒时间 "HH:MM"
  createdAt: string
  updatedAt: string
}

export interface ReadingRecord {
  id: string
  userId: string
  articleId: string
  articleTitle: string
  date: string // YYYY-MM-DD
  status: 'reading' | 'completed'
  readingTimeSeconds: number
  createdAt: string
  updatedAt: string
}

/** 最后一轮（第 4 轮追问）收尾时的五维评估分（0-10，来自 AI article_scores） */
export interface FinalScores {
  independent_thinking: number
  evidence_quality: number
  logic_structure: number
  word_precision: number
  reflection_depth: number
}

export interface QuizAnswer {
  id: string
  userId: string
  articleId: string
  questionId: string
  questionText: string
  dimension: ThinkingDimension
  userAnswer: string
  aiAnalysis: string
  aiScore: number // 0-10（初次回答不评分，恒为 0；分数在最后一轮收尾时产生）
  /** 五维收尾评分（最后一轮对话结束时写入；缺失表示尚未完成收尾） */
  finalScores?: FinalScores | null
  /** 收尾总评（≤50 字） */
  finalComment?: string
  /** 思考流程图（最后一轮收尾输出） */
  thoughtFlow?: string
  dialogueTurns: DialogueTurn[] // 对话轮次记录
  completed: boolean // 是否已结束对话（完成该题）
  createdAt: string
  completedAt: string | null
}

/** 单轮对话记录（思考题下方的深挖对话） */
export interface DialogueTurn {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface ChatMessage {
  id: string
  userId: string
  articleId: string | null
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface DimensionScore {
  dimension: ThinkingDimension
  score: number // 0-10
}

export interface Assessment {
  id: string
  userId: string
  date: string // YYYY-MM-DD
  dimensionScores: DimensionScore[]
  summary: string
  dayCount: number // 第几天的测评
  createdAt: string
}

// ===== 通用类型 =====

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
