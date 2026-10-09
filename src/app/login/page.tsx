'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { BookOpenIcon, Loader2Icon } from 'lucide-react'
import { track, identifyUser } from '@/lib/tracker'

export default function LoginPage() {
  const router = useRouter()
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogin(e?: React.FormEvent) {
    e?.preventDefault()
    const trimmed = nickname.trim()
    if (!trimmed) {
      setError('请输入你的昵称')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: trimmed }),
      })
      const data = await res.json()

      if (data.success && data.user) {
        // 存到 localStorage 供 AuthGuard 和 storage.ts 使用
        localStorage.setItem('arc_nickname', data.user.nickname)
        localStorage.setItem('arc_user_id', data.user.id)
        // 埋点：登录成功
        identifyUser(data.user.id, data.user.nickname)
        void track('login', { nickname: data.user.nickname, user_id: data.user.id })
        router.replace('/')
      } else {
        setError(data.error ?? '登录失败，请重试')
      }
    } catch {
      setError('网络错误，请检查网络后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
          <BookOpenIcon className="size-8 text-primary" />
        </div>
        <div className="text-center">
          <h1 className="text-xl font-semibold">AI 阅读陪伴</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            每天一篇好文章，五维度提升阅读思维
          </p>
        </div>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base">输入昵称开始</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Input
                placeholder="你的昵称"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={20}
                autoFocus
              />
              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}
            </div>
            <Button type="submit" disabled={loading || !nickname.trim()}>
              {loading ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  正在进入...
                </>
              ) : (
                '开始阅读'
              )}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              昵称用于记录你的阅读进度和测评数据
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
