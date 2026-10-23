'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { BookOpenIcon, Loader2Icon } from 'lucide-react'
import { track, identifyUser } from '@/lib/tracker'
import { loginWithNickname } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogin(e?: React.FormEvent) {
    e?.preventDefault()
    const trimmed = nickname.trim()
    if (!trimmed) {
      setError('请输入你的昵称')
      return
    }
    if (password.length < 6) {
      setError('密码至少 6 位')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await loginWithNickname(trimmed, password)

      if (result.success) {
        identifyUser(
          localStorage.getItem('arc_user_id') ?? '',
          trimmed
        )
        void track('login', { nickname: trimmed })
        router.replace('/')
      } else {
        setError(result.error ?? '登录失败，请重试')
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
          <h1 className="text-xl font-semibold">想了想</h1>
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
              <Input
                type="password"
                placeholder="密码（至少 6 位）"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
              />
              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}
            </div>
            <Button type="submit" disabled={loading || !nickname.trim() || password.length < 6}>
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
              首次输入昵称会自动注册，之后用同样的昵称和密码登录
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
