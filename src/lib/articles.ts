/**
 * 文章数据访问层
 *
 * 从 /workspace/daily-articles/ 目录读取自动化产出的 JSON 文件。
 * 在 Next.js 中通过 API Route 调用，前端不直接访问文件系统。
 */

import fs from 'fs'
import path from 'path'
import type { DailyArticles, Article } from '@/types'

// 文章数据目录：优先读环境变量 ARTICLES_DIR，默认为项目根目录下的 daily-articles/
// （每日定时任务产出的 JSON 存放位置）
const ARTICLES_DIR = process.env.ARTICLES_DIR || path.join(process.cwd(), 'daily-articles')

function getArticlesDir(): string {
  return ARTICLES_DIR
}

/** 获取指定日期的文章 */
export function getArticlesByDate(date: string): DailyArticles | null {
  const dir = getArticlesDir()
  const filePath = path.join(dir, `${date}.json`)

  if (!fs.existsSync(filePath)) {
    return null
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as DailyArticles
  } catch (e) {
    console.error(`Failed to parse articles for ${date}:`, e)
    return null
  }
}

/**
 * 测评基准文章：延迟满足（2026-09-13 生成）
 * 固定追加在每日文章列表末尾，用作 prompt 用例测试的标准文章。
 * pilot 上线前移除：删除本常量并还原 getTodayArticles 中的 withBenchmarkArticle 调用即可。
 */
const BENCHMARK_ARTICLE_ID = '20260913-006'

/** 在每日列表末尾追加测评基准文章（当日列表已含或找不到时原样返回） */
function withBenchmarkArticle(data: DailyArticles): DailyArticles {
  if (data.articles.some((a) => a.id === BENCHMARK_ARTICLE_ID)) return data
  const bench = getArticleById(BENCHMARK_ARTICLE_ID)
  if (!bench) return data
  return { ...data, articles: [...data.articles, bench.article] }
}

/** 获取今天的文章（若今天无文章则回退到最近一天） */
export function getTodayArticles(): DailyArticles | null {
  const today = new Date().toISOString().slice(0, 10)
  const todayArticles = getArticlesByDate(today)
  if (todayArticles) return withBenchmarkArticle(todayArticles)

  // 今天没有文章 → 回退到最近一天的文章
  const dates = getAvailableDates()
  if (dates.length === 0) return null
  const fallback = getArticlesByDate(dates[0])
  return fallback ? withBenchmarkArticle(fallback) : null
}

/** 获取所有可用日期列表 */
export function getAvailableDates(): string[] {
  const dir = getArticlesDir()
  if (!fs.existsSync(dir)) return []

  const files = fs.readdirSync(dir)
  return files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''))
    .sort()
    .reverse() // 最新的在前
}

/** 获取最近 N 天的文章 */
export function getRecentArticles(days: number = 7): DailyArticles[] {
  const dates = getAvailableDates().slice(0, days)
  return dates
    .map((date) => getArticlesByDate(date))
    .filter((data): data is DailyArticles => data !== null)
}

/** 根据 ID 查找文章 */
export function getArticleById(articleId: string): { article: Article; date: string } | null {
  const dates = getAvailableDates()
  for (const date of dates) {
    const dailyData = getArticlesByDate(date)
    if (dailyData) {
      const article = dailyData.articles.find((a) => a.id === articleId)
      if (article) {
        return { article, date }
      }
    }
  }
  return null
}
