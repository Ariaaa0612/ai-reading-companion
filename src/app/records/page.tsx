'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, Calendar, Flame, ChevronRightIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { recordStorage } from '@/lib/storage'
import type { ReadingRecord } from '@/types'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

interface CalendarDay {
  dateStr: string
  day: number
  weekday: string
  checked: boolean
  isToday: boolean
}

export default function RecordsPage() {
  const router = useRouter()
  const [records, setRecords] = useState<ReadingRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      setRecords(recordStorage.list())
    } catch (e) {
      console.error('加载打卡记录失败', e)
      setError('加载打卡记录失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const streak = useMemo(() => {
    if (loading) return 0
    return recordStorage.getStreakDays()
  }, [records, loading])

  const totalArticles = useMemo(() => {
    return new Set(records.map((r) => r.articleId)).size
  }, [records])

  // 最近 7 天日历
  const last7Days: CalendarDay[] = useMemo(() => {
    const recordDates = new Set(records.map((r) => r.date))
    const today = new Date()
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today)
      d.setDate(d.getDate() - (6 - i))
      const dateStr = d.toISOString().slice(0, 10)
      return {
        dateStr,
        day: d.getUTCDate(),
        weekday: WEEKDAYS[d.getUTCDay()],
        checked: recordDates.has(dateStr),
        isToday: i === 6,
      }
    })
  }, [records])

  // 按日期分组（倒序）
  const groupedRecords = useMemo(() => {
    const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date))
    const groups: { date: string; items: ReadingRecord[] }[] = []
    for (const r of sorted) {
      const last = groups[groups.length - 1]
      if (last && last.date === r.date) {
        last.items.push(r)
      } else {
        groups.push({ date: r.date, items: [r] })
      }
    }
    return groups
  }, [records])

  function handleArticleClick(articleId: string) {
    router.push(`/article/${articleId}`)
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-[430px] bg-background pb-20">
      {/* 标题 */}
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-semibold">阅读打卡</h1>
        <p className="text-xs text-muted-foreground">坚持阅读，看见自己的成长</p>
      </header>

      <ScrollArea className="h-[calc(100vh-64px)]">
        <div className="flex flex-col gap-4 p-4">
          {loading ? (
            <>
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </>
          ) : error ? (
            <Card>
              <CardContent>
                <p className="py-6 text-center text-sm text-destructive">{error}</p>
              </CardContent>
            </Card>
          ) : records.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <div className="flex size-16 items-center justify-center rounded-full bg-muted text-3xl">
                  📚
                </div>
                <p className="text-sm font-medium">还没有打卡记录</p>
                <p className="text-xs text-muted-foreground">去读第一篇文章吧</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* 连续打卡 + 总篇数 */}
              <div className="grid grid-cols-2 gap-3">
                <Card>
                  <CardContent className="flex flex-col items-center gap-1 py-4">
                    <Flame className="size-5 text-orange-500" />
                    <span className="text-3xl font-bold tabular-nums">{streak}</span>
                    <span className="text-xs text-muted-foreground">连续打卡天数</span>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="flex flex-col items-center gap-1 py-4">
                    <BookOpen className="size-5 text-blue-500" />
                    <span className="text-3xl font-bold tabular-nums">{totalArticles}</span>
                    <span className="text-xs text-muted-foreground">总阅读篇数</span>
                  </CardContent>
                </Card>
              </div>

              {/* 最近 7 天日历 */}
              <Card>
                <CardContent className="flex flex-col gap-3 py-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Calendar className="size-4" />
                    最近 7 天
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {last7Days.map((d) => (
                      <div
                        key={d.dateStr}
                        className="flex flex-col items-center gap-1"
                      >
                        <span className="text-[10px] text-muted-foreground">{d.weekday}</span>
                        <div
                          className={
                            d.checked
                              ? 'flex size-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground'
                              : d.isToday
                                ? 'flex size-8 items-center justify-center rounded-full border-2 border-primary text-xs font-medium text-primary'
                                : 'flex size-8 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground'
                          }
                        >
                          {d.day}
                        </div>
                        {d.checked ? (
                          <span className="text-[10px] text-primary">打卡</span>
                        ) : (
                          <span className="text-[10px] text-transparent">·</span>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* 打卡记录列表 */}
              <div className="flex flex-col gap-3">
                <h2 className="px-1 text-sm font-medium">打卡记录</h2>
                <p className="px-1 text-xs text-muted-foreground">点击文章可查看你的答题和对话记录</p>
                {groupedRecords.map((group) => (
                  <div key={group.date} className="flex flex-col gap-2">
                    <div className="px-1 text-xs font-medium text-muted-foreground">
                      {group.date}
                    </div>
                    {group.items.map((r) => (
                      <Card
                        key={r.id}
                        className="cursor-pointer transition-shadow hover:shadow-md active:scale-[0.99]"
                        onClick={() => handleArticleClick(r.articleId)}
                      >
                        <CardContent className="flex items-center justify-between py-3">
                          <div className="flex min-w-0 flex-col gap-1">
                            <span className="truncate text-sm font-medium">
                              {r.articleTitle}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {r.date} · 点击查看答题记录
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Badge variant={r.status === 'completed' ? 'default' : 'secondary'}>
                              {r.status === 'completed' ? '已读' : '阅读中'}
                            </Badge>
                            <ChevronRightIcon className="size-4 text-muted-foreground" />
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
