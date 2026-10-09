import type { NextRequest } from 'next/server'

import { getArticleById, getArticlesByDate, getTodayArticles } from '@/lib/articles'
import type { ApiResponse, Article, DailyArticles } from '@/types'

/**
 * 文章接口
 * - 无参数：返回今天的文章列表
 * - ?date=YYYY-MM-DD：返回指定日期的文章
 * - ?id=文章ID：返回指定文章
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const date = searchParams.get('date')
  const id = searchParams.get('id')

  try {
    // 指定文章 ID
    if (id) {
      const result = getArticleById(id)
      if (!result) {
        return Response.json(
          { success: false, error: '未找到该文章' } satisfies ApiResponse<never>,
          { status: 404 }
        )
      }
      const payload: { article: Article; date: string } = result
      return Response.json(
        { success: true, data: payload } satisfies ApiResponse<{ article: Article; date: string }>
      )
    }

    // 指定日期或今天
    const daily: DailyArticles | null = date ? getArticlesByDate(date) : getTodayArticles()
    if (!daily) {
      const msg = date ? `未找到 ${date} 的文章` : '今日暂无文章，请稍后再来'
      return Response.json(
        { success: false, error: msg } satisfies ApiResponse<never>,
        { status: 404 }
      )
    }

    return Response.json(
      { success: true, data: daily } satisfies ApiResponse<DailyArticles>
    )
  } catch (e) {
    console.error('[api/articles] error:', e)
    return Response.json(
      { success: false, error: '获取文章失败，请稍后重试' } satisfies ApiResponse<never>,
      { status: 500 }
    )
  }
}
