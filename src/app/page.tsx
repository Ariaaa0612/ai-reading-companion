"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarIcon, ClockIcon, LogOutIcon, TrendingUpIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import type {
  ApiResponse,
  Article,
  DailyArticles,
  Difficulty,
  UserPlan,
} from "@/types";
import { planStorage, recordStorage, syncAllFromCloud } from "@/lib/storage";
import { getCurrentNickname, logout } from "@/lib/supabase";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const DIFFICULTY_VARIANT: Record<Difficulty, BadgeVariant> = {
  入门: "secondary",
  进阶: "default",
  深度: "destructive",
};

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function formatDateDisplay(dateStr: string): string {
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return dateStr;
  const [, month, day] = parts;
  const date = new Date(parts[0], month - 1, day);
  return `${month}月${day}日 ${WEEKDAYS[date.getDay()]}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export default function HomePage() {
  const router = useRouter();
  const [data, setData] = useState<DailyArticles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [plan, setPlan] = useState<UserPlan | null>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [nickname, setNickname] = useState<string | null>(null);

  useEffect(() => {
    setNickname(getCurrentNickname());
  }, []);

  const handleLogout = () => {
    if (window.confirm("退出将清除本机数据，下次登录会自动恢复，确定退出？")) {
      void logout();
      router.replace("/login");
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // 先从云端同步数据（换设备时恢复数据）
        await syncAllFromCloud();

        const res = await fetch("/api/articles", { cache: "no-store" });
        if (!res.ok) throw new Error(`请求失败（${res.status}）`);
        const json: ApiResponse<DailyArticles> = await res.json();
        const payload = json.data;
        if (!json.success || !payload) {
          throw new Error(json.error ?? "获取今日文章失败");
        }
        if (cancelled) return;
        setData(payload);

        const existingPlan = planStorage.get();
        if (cancelled) return;
        setPlan(existingPlan);
        if (existingPlan) {
          const todayRecords = recordStorage.listByDate(payload.date);
          const done = todayRecords.filter(
            (r) => r.status === "completed"
          ).length;
          setCompletedCount(done);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "加载失败，请稍后重试");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const dateLabel = data ? formatDateDisplay(data.date) : "";
  const goal = plan?.dailyGoal ?? 0;
  const progressValue =
    goal > 0 ? Math.min((completedCount / goal) * 100, 100) : 0;

  return (
    <main className="flex flex-col gap-4 px-4 pb-20 pt-6">
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CalendarIcon className="size-4" />
            <span className="text-sm">{dateLabel || "今日"}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">今日阅读</h1>
        </div>
        {nickname && (
          <button
            type="button"
            onClick={handleLogout}
            className="mt-1 flex shrink-0 items-center gap-1 rounded-full border border-muted px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
            title="退出登录（清除本机数据，云端保留）"
          >
            <span className="max-w-24 truncate font-medium text-foreground">
              {nickname}
            </span>
            <LogOutIcon className="size-3.5" />
            退出
          </button>
        )}
      </header>

      {plan && goal > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">今日目标</CardTitle>
            <CardDescription>
              已读 {completedCount} / {goal} 篇
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={progressValue} />
          </CardContent>
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">推荐文章</h2>

        {loading && <ArticleListSkeleton />}

        {!loading && error && (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              {error}
            </CardContent>
          </Card>
        )}

        {!loading && !error && (!data || data.articles.length === 0) && (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              今天还没有文章，请稍后再来。
            </CardContent>
          </Card>
        )}

        {!loading &&
          !error &&
          data &&
          data.articles.length > 0 &&
          data.articles.map((article: Article) => (
            <ArticleCard key={article.id} article={article} />
          ))}
      </section>

      {!loading && !error && data && data.trendCommentary && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUpIcon className="size-4" />
              趋势点评
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed text-muted-foreground">
            {data.trendCommentary}
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function ArticleCard({ article }: { article: Article }) {
  return (
    <Link href={`/article/${article.id}`} className="block">
      <Card className="transition-all hover:shadow-md active:scale-[0.99]">
        <CardHeader>
          <CardTitle className="text-base leading-snug">
            {article.title}
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            <Badge variant={DIFFICULTY_VARIANT[article.difficulty]}>
              {article.difficulty}
            </Badge>
            <span className="flex items-center gap-1">
              <ClockIcon className="size-3" />
              {article.readingTime} 分钟
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {truncate(article.summary, 80)}
          </p>
          {article.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {article.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function ArticleListSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="mt-2 h-3 w-1/3" />
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
