"use client";

import { useEffect, useState, useMemo } from "react";
import { toast } from "sonner";
import { BellIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { planStorage } from "@/lib/storage";
import { track } from "@/lib/tracker";

const DAILY_GOAL_OPTIONS = [1, 2, 3, 4, 5] as const;

// 0 = 周日，1 = 周一 … 6 = 周六（与 UserPlan.weekdays 约定一致）
const WEEKDAY_OPTIONS: readonly { label: string; value: number }[] = [
  { label: "一", value: 1 },
  { label: "二", value: 2 },
  { label: "三", value: 3 },
  { label: "四", value: 4 },
  { label: "五", value: 5 },
  { label: "六", value: 6 },
  { label: "日", value: 0 },
] as const;

const WEEKDAY_FULL: Record<number, string> = {
  0: "周日",
  1: "周一",
  2: "周二",
  3: "周三",
  4: "周四",
  5: "周五",
  6: "周六",
};

/** 将 "08:30" 转为 "上午 8:30" / "下午 6:30" */
function formatTimeLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (h < 12) {
    return `上午 ${h}:${m.toString().padStart(2, "0")}`;
  } else if (h === 12) {
    return `中午 12:${m.toString().padStart(2, "0")}`;
  } else {
    return `下午 ${h - 12}:${m.toString().padStart(2, "0")}`;
  }
}

export default function PlanPage() {
  const [dailyGoal, setDailyGoal] = useState<number>(1);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [reminderTime, setReminderTime] = useState<string>("08:00");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    function load() {
      const existing = planStorage.get();
      if (cancelled) return;
      if (existing) {
        setDailyGoal(existing.dailyGoal);
        setWeekdays(existing.weekdays);
        if (existing.reminderTime) {
          setReminderTime(existing.reminderTime);
        }
        setSaved(true);
      }
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleWeekday(value: number) {
    setWeekdays((prev) =>
      prev.includes(value)
        ? prev.filter((v) => v !== value)
        : [...prev, value]
    );
    setSaved(false);
  }

  async function handleSave() {
    if (weekdays.length === 0) {
      toast.error("请至少选择一个阅读日");
      return;
    }
    setSaving(true);
    try {
      await planStorage.save({
        dailyGoal,
        weekdays: [...weekdays].sort((a, b) => {
          if (a === 0) return 1;
          if (b === 0) return -1;
          return a - b;
        }),
        reminderTime,
      });
      // 埋点：设置阅读计划
      void track('plan_set', {
        daily_goal: dailyGoal,
        weekdays_count: weekdays.length,
        reminder_time: reminderTime ?? '',
      });
      setSaved(true);
      toast.success("阅读计划已保存");
    } catch {
      toast.error("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  // 选中的阅读日文案
  const selectedDaysText = useMemo(() => {
    if (weekdays.length === 0) return "尚未选择";
    const sorted = [...weekdays].sort((a, b) => {
      if (a === 0) return 1;
      if (b === 0) return -1;
      return a - b;
    });
    return sorted.map((d) => WEEKDAY_FULL[d]).join("、");
  }, [weekdays]);

  const reminderLabel = formatTimeLabel(reminderTime);

  if (loading) {
    return (
      <main className="flex flex-col gap-4 px-4 pb-20 pt-6">
        <Skeleton className="h-8 w-40" />
        <Card>
          <CardContent className="flex flex-col gap-5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-4 px-4 pb-20 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">阅读计划</h1>

      <Card>
        <CardContent className="flex flex-col gap-6">
          {/* 每日目标篇数 */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">每天读几篇</span>
            <div className="flex gap-2">
              {DAILY_GOAL_OPTIONS.map((n) => (
                <Button
                  key={n}
                  type="button"
                  variant={dailyGoal === n ? "default" : "outline"}
                  size="icon"
                  onClick={() => {
                    setDailyGoal(n);
                    setSaved(false);
                  }}
                  aria-pressed={dailyGoal === n}
                >
                  {n}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              每天计划阅读 {dailyGoal} 篇
            </p>
          </div>

          {/* 每周阅读日 */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">每周哪几天阅读</span>
            <div className="flex gap-2">
              {WEEKDAY_OPTIONS.map((opt) => {
                const selected = weekdays.includes(opt.value);
                return (
                  <Button
                    key={opt.value}
                    type="button"
                    variant={selected ? "default" : "outline"}
                    size="icon"
                    onClick={() => toggleWeekday(opt.value)}
                    aria-pressed={selected}
                    aria-label={`周${opt.label}`}
                  >
                    {opt.label}
                  </Button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              可多选，已选 {weekdays.length} 天
            </p>
          </div>

          {/* 提醒时间 - 时间滚轮选择器 */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">每天几点提醒你</span>
            <div className="flex items-center gap-3">
              <input
                type="time"
                value={reminderTime}
                onChange={(e) => {
                  setReminderTime(e.target.value);
                  setSaved(false);
                }}
                className="flex h-10 w-32 rounded-md border border-input bg-background px-3 text-base font-medium tabular-nums ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label="选择提醒时间"
              />
              <span className="text-sm text-muted-foreground">
                {reminderLabel}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              到了这个时间如果还没打卡，打开应用会看到提醒
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 推送时间说明 */}
      {weekdays.length > 0 && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="flex flex-col gap-2 py-4">
            <div className="flex items-center gap-2">
              <BellIcon className="size-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-900">
                推送安排
              </span>
            </div>
            <p className="text-sm text-blue-800">
              {selectedDaysText}，每天 {reminderLabel} 会提醒你来读 {dailyGoal} 篇新的 AI 文章。
            </p>
            <p className="text-xs text-blue-600">
              文章每天早上 7 点自动更新，你选定的时间是提醒你来看的时间。
            </p>
          </CardContent>
        </Card>
      )}

      {/* 已保存的确认提示 */}
      {saved && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="flex items-center gap-2 py-3 text-sm text-green-700">
            <CheckIcon className="size-4" />
            计划已生效！{selectedDaysText} {reminderLabel} 见。
          </CardContent>
        </Card>
      )}

      <Button
        size="lg"
        className="w-full"
        onClick={handleSave}
        disabled={saving || weekdays.length === 0}
      >
        {saving ? "保存中…" : "保存计划"}
      </Button>
    </main>
  );
}
