"use client";

import { use, useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  CheckIcon,
  ClockIcon,
  LightbulbIcon,
  Loader2Icon,
  SendIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { VoiceInput } from "@/components/VoiceInput";
import type {
  ApiResponse,
  Article,
  FinalScores,
  ThinkingDimension,
  ThinkingQuestion,
  DialogueTurn,
} from "@/types";
import { quizStorage, recordStorage, assessmentStorage } from "@/lib/storage";
import { track } from "@/lib/tracker";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

type QuestionState = "unanswered" | "analyzed" | "dialoguing" | "completed";

type Feedback = { score: number; analysis: string };

type AnalyzeResponse = { aiAnalysis: string; aiScore: number; valid: boolean; validationMessage?: string };
type ChatResponse = {
  reply: string;
  acknowledge?: string;
  followUpQuestion?: string;
  isFinalRound?: boolean;
  thoughtFlow?: string;
  articleScores?: FinalScores | null;
  articleComment?: string;
  guideToThinkingGuide?: string;
};

/** 最后一轮（总结轮）收尾结果（用于完成态展示；guide 仅本次会话有，历史数据缺省） */
type FinalResult = {
  scores: FinalScores;
  comment: string;
  thoughtFlow: string;
  guide?: string;
};

type FlowNode = { label: string | null; text: string; current: boolean };

/** 解析思考流程文本为节点列表：兼容树形符号（┌├└│─）与纯文本行 */
function parseThoughtFlow(flow: string): FlowNode[] {
  return flow
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^用户思考路径(流程图)?[:：]?$/.test(l))
    .map((line) => {
      const content = line.replace(/^[┌├└│─\s]+/, "").trim();
      const m = content.match(/^(起点|当前|总结[^：:]*|第\s*\d+\s*轮[^：:]*)[:：]\s*(.+)$/);
      if (m) {
        return { label: m[1].trim(), text: m[2].trim(), current: /当前|总结/.test(m[1]) };
      }
      return { label: null, text: content, current: false };
    });
}

/** 思考流程竖向树：节点圆点 + 连接线 + 阶段标签，当前/总结节点高亮 */
function ThoughtFlowTree({ flow }: { flow: string }) {
  const nodes = parseThoughtFlow(flow);
  if (nodes.length === 0) {
    return <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{flow}</p>;
  }
  return (
    <div className="mt-2 flex flex-col">
      {nodes.map((n, i) => (
        <div key={i} className="flex gap-2.5">
          <div className="flex flex-col items-center">
            <span
              className={cn(
                "mt-1.5 size-2.5 shrink-0 rounded-full",
                n.current ? "bg-primary" : "bg-primary/40"
              )}
            />
            {i < nodes.length - 1 && <span className="w-px flex-1 bg-primary/30" />}
          </div>
          <div className={cn("flex-1", i === nodes.length - 1 ? "pb-0.5" : "pb-3")}>
            {n.label && (
              <span
                className={cn(
                  "mb-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium",
                  n.current
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {n.label}
              </span>
            )}
            <p className="text-sm leading-relaxed text-foreground">{n.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 对话消息：assistant 消息附带结构化字段用于分行展示（恢复的历史消息无 detail，退回纯文本） */
type DisplayTurn = DialogueTurn & {
  detail?: {
    acknowledge?: string;
    followUpQuestion?: string;
    isFinalRound?: boolean;
    /** 第 4 轮追问 = 总结性问题（气泡标签显示「总结问题」） */
    isSummaryQuestion?: boolean;
  };
};

/** 思考指南引导缺省文案 */
const DEFAULT_GUIDE_TEXT =
  "想看你在本阶段的整体思考能力变化，可以去测评的「思考指南」。";

const DIFFICULTY_VARIANT: Record<Article["difficulty"], BadgeVariant> = {
  入门: "secondary",
  进阶: "default",
  深度: "destructive",
};

const DIMENSION_VARIANT: Record<ThinkingDimension, BadgeVariant> = {
  理解力: "default",
  批判性思维: "destructive",
  联想力: "secondary",
  表达力: "outline",
  反思力: "secondary",
};

// ===== AI 分析结构化展示 =====

/** 已知评估标签：绿色=优点类，琥珀=问题类 */
const POSITIVE_LABELS = ["亮点", "优点"];
const NEGATIVE_LABELS = ["问题", "主要问题", "可提升", "原因", "建议"];
const ALL_LABELS = [...POSITIVE_LABELS, ...NEGATIVE_LABELS].join("|");

/**
 * 把 AI 分析文本（response + "\n\n" + assessment）分行渲染：
 * - 首段接续语为普通段落
 * - assessment 每行独立成块，带标签前缀（如"亮点："）的行渲染彩色标签
 * - 无标签的行（如"1.xxx"编号要点）缩进呈现
 */
function AssessmentBlock({ text }: { text: string }) {
  const idx = text.indexOf("\n\n");
  const responsePart = idx >= 0 ? text.slice(0, idx) : "";
  const assessmentPart = idx >= 0 ? text.slice(idx + 2) : text;
  const lines = assessmentPart
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {responsePart && (
        <p className="text-sm leading-relaxed text-foreground">{responsePart}</p>
      )}
      {lines.map((line, i) => {
        const m = line.match(new RegExp(`^(${ALL_LABELS})：?(.*)$`));
        if (!m) {
          return (
            <p
              key={i}
              className="border-l-2 border-muted pl-2 text-sm leading-relaxed text-foreground/85"
            >
              {line}
            </p>
          );
        }
        const isPositive = POSITIVE_LABELS.includes(m[1]);
        return (
          <div key={i} className="flex items-start gap-1.5">
            <span
              className={cn(
                "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium",
                isPositive
                  ? "bg-green-100 text-green-700"
                  : "bg-amber-100 text-amber-700"
              )}
            >
              {m[1]}
            </span>
            {m[2] && (
              <p className="text-sm leading-relaxed text-foreground">{m[2]}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ArticleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 每道题的状态
  const [questionStates, setQuestionStates] = useState<Record<string, QuestionState>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [analyzing, setAnalyzing] = useState<Record<string, boolean>>({});

  // 对话状态
  const [dialogueMessages, setDialogueMessages] = useState<Record<string, DisplayTurn[]>>({});
  const [dialogueInput, setDialogueInput] = useState<Record<string, string>>({});
  const [dialogueLoading, setDialogueLoading] = useState<Record<string, boolean>>({});

  // 最后一轮收尾结果（五维评分 + 总评 + 思考流程）
  const [finalResults, setFinalResults] = useState<Record<string, FinalResult>>({});

  const [autoCheckedIn, setAutoCheckedIn] = useState(false);
  const checkInDaysRef = useRef(0);

  // 加载文章数据 + 恢复已有答题状态
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/articles?id=${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`请求失败（${res.status}）`);
        const json: ApiResponse<{ article: Article; date: string }> = await res.json();
        const payload = json.data;
        if (!json.success || !payload) {
          throw new Error(json.error ?? "文章不存在或已下架");
        }
        if (cancelled) return;

        setArticle(payload.article);

        // 埋点：打开文章
        void track("article_opened", {
          article_id: payload.article.id,
          article_title: payload.article.title,
          difficulty: payload.article.difficulty,
        });

        // 获取打卡天数（影响评分阶段和追问语气）
        checkInDaysRef.current = assessmentStorage.getUsageDays();

        // 恢复已有答题状态
        const existingAnswers = quizStorage.getByArticle(payload.article.id);
        const restoredStates: Record<string, QuestionState> = {};
        const restoredFeedback: Record<string, Feedback> = {};
        const restoredAnswers: Record<string, string> = {};
        const restoredDialogues: Record<string, DialogueTurn[]> = {};
        const restoredFinals: Record<string, FinalResult> = {};

        for (const ans of existingAnswers) {
          restoredAnswers[ans.questionId] = ans.userAnswer;
          restoredFeedback[ans.questionId] = {
            score: ans.aiScore,
            analysis: ans.aiAnalysis,
          };
          restoredDialogues[ans.questionId] = ans.dialogueTurns ?? [];
          // 恢复最后一轮收尾结果（若有）
          if (ans.finalScores) {
            restoredFinals[ans.questionId] = {
              scores: ans.finalScores,
              comment: ans.finalComment ?? "",
              thoughtFlow: ans.thoughtFlow ?? "",
            };
          }
          if (ans.completed) {
            restoredStates[ans.questionId] = "completed";
          } else if (ans.dialogueTurns && ans.dialogueTurns.length > 0) {
            restoredStates[ans.questionId] = "dialoguing";
          } else {
            restoredStates[ans.questionId] = "analyzed";
          }
        }

        if (cancelled) return;
        setQuestionStates(restoredStates);
        setAnswers(restoredAnswers);
        setFeedback(restoredFeedback);
        setDialogueMessages(restoredDialogues);
        setFinalResults(restoredFinals);

        // 检查是否已打卡过：完成任意一道思考题即视为已打卡
        const totalQs = payload.article.thinkingQuestions.length;
        if (totalQs > 0 && existingAnswers.some((a) => a.completed)) {
          setAutoCheckedIn(true);
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
  }, [id]);

  // 自动打卡：完成任意一道思考题即算当日打卡
  useEffect(() => {
    if (!article || autoCheckedIn) return;
    if (article.thinkingQuestions.length === 0) return;

    const completedCount = Object.values(questionStates).filter(
      (s) => s === "completed"
    ).length;

    if (completedCount >= 1) {
      void recordStorage.autoCheckIn(article.id, article.title);
      setAutoCheckedIn(true);
      toast.success("太棒了！今天打卡成功！");
      // 埋点：打卡成功
      void track("check_in", {
        article_id: article.id,
        article_title: article.title,
        day_count: assessmentStorage.getUsageDays(),
      });
    }
  }, [article, questionStates, autoCheckedIn]);

  // 提交分析
  async function handleAnalyze(question: ThinkingQuestion) {
    const answer = (answers[question.id] ?? "").trim();
    if (!answer) {
      toast.error("请先写下你的想法再提交");
      return;
    }
    if (!article) return;

    setAnalyzing((prev) => ({ ...prev, [question.id]: true }));

    try {
      const res = await fetch("/api/quiz/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleId: article.id,
          questionId: question.id,
          questionText: question.question,
          dimension: question.type,
          userAnswer: answer,
          articleTitle: article.title,
          articleSummary: article.summary,
          checkInDays: checkInDaysRef.current,
          weakDimension: assessmentStorage.getWeakDimension()?.dimension ?? null,
          hasImproved: assessmentStorage.hasWeakDimensionImproved(),
        }),
      });
      if (!res.ok) throw new Error(`分析失败（${res.status}）`);
      const json: ApiResponse<AnalyzeResponse> = await res.json();
      const payload = json.data;
      if (!json.success || !payload) {
        throw new Error(json.error ?? "AI 分析失败");
      }

      // 敷衍作答校验
      if (!payload.valid) {
        toast.error(payload.validationMessage ?? "能再多聊聊你的想法吗？");
        return;
      }

      setFeedback((prev) => ({
        ...prev,
        [question.id]: {
          score: payload.aiScore,
          analysis: payload.aiAnalysis,
        },
      }));

      void quizStorage.saveInitial({
        articleId: article.id,
        questionId: question.id,
        questionText: question.question,
        dimension: question.type,
        userAnswer: answer,
        aiAnalysis: payload.aiAnalysis,
        aiScore: payload.aiScore,
      });

      // 埋点：回答思考题
      void track("question_answered", {
        article_id: article.id,
        question_id: question.id,
        dimension: question.type,
        score: payload.aiScore,
        answer_length: answer.length,
        stage: checkInDaysRef.current <= 3 ? "启蒙期" : checkInDaysRef.current <= 13 ? "成长期" : "进阶期",
      });

      setQuestionStates((prev) => ({ ...prev, [question.id]: "analyzed" }));
      toast.success("分析完成，可以继续深入聊聊");
    } catch (e) {
      const message = e instanceof Error ? e.message : "分析失败，请重试";
      toast.error(message);
    } finally {
      setAnalyzing((prev) => ({ ...prev, [question.id]: false }));
    }
  }

  // 开始对话
  function startDialogue(questionId: string) {
    setQuestionStates((prev) => ({ ...prev, [questionId]: "dialoguing" }));
    // 埋点：开始深挖对话
    if (article) {
      void track("dialogue_started", {
        article_id: article.id,
        question_id: questionId,
      });
    }
  }

  // 发送对话消息
  async function handleSendDialogue(question: ThinkingQuestion) {
    const msg = (dialogueInput[question.id] ?? "").trim();
    if (!msg || !article) return;

    const userTurn: DialogueTurn = {
      role: "user",
      content: msg,
      createdAt: new Date().toISOString(),
    };

    // 更新 UI
    setDialogueMessages((prev) => ({
      ...prev,
      [question.id]: [...(prev[question.id] ?? []), userTurn],
    }));
    setDialogueInput((prev) => ({ ...prev, [question.id]: "" }));
    setDialogueLoading((prev) => ({ ...prev, [question.id]: true }));

    // 存储到本地 + 云端
    void quizStorage.addDialogueTurn(article.id, question.id, {
      role: "user",
      content: msg,
    });

    try {
      const history = dialogueMessages[question.id] ?? [];
      const firstAnswer = answers[question.id] ?? "";
      const aiAnalysis = feedback[question.id]?.analysis ?? "";
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          articleId: article.id,
          articleTitle: article.title,
          articleSummary: article.summary,
          articleKeyPoints: article.keyPoints,
          questionText: question.question,
          dimension: question.type,
          firstAnswer,
          aiAnalysis,
          dialogueHistory: history,
          checkInDays: checkInDaysRef.current,
        }),
      });
      if (!res.ok) throw new Error(`对话失败（${res.status}）`);
      const json: ApiResponse<ChatResponse> = await res.json();
      const payload = json.data;
      if (!json.success || !payload) {
        throw new Error(json.error ?? "AI 回复失败");
      }

      // 该条 AI 消息是第几条追问（用于标记总结性问题）
      const assistantIndex =
        history.filter((m) => m.role === "assistant").length + 1;

      const aiTurn: DisplayTurn = {
        role: "assistant",
        content: payload.reply,
        createdAt: new Date().toISOString(),
        detail: {
          acknowledge: payload.acknowledge,
          followUpQuestion: payload.followUpQuestion,
          isFinalRound: payload.isFinalRound,
          isSummaryQuestion: assistantIndex === 4,
        },
      };

      setDialogueMessages((prev) => ({
        ...prev,
        [question.id]: [...(prev[question.id] ?? []), aiTurn],
      }));

      void quizStorage.addDialogueTurn(article.id, question.id, {
        role: "assistant",
        content: payload.reply,
      });

      // ===== 最后一轮收尾：消费五维评分并完成该题 =====
      if (payload.isFinalRound && payload.articleScores) {
        const s = payload.articleScores;
        const overall =
          Math.round(
            ((s.independent_thinking +
              s.evidence_quality +
              s.logic_structure +
              s.word_precision +
              s.reflection_depth) /
              5) *
              10
          ) / 10;

        // 落库：五维评分 + 总评 + 思考流程图
        void quizStorage.saveFinalScores(article.id, question.id, {
          finalScores: s,
          finalComment: payload.articleComment ?? "",
          thoughtFlow: payload.thoughtFlow ?? "",
        });

        setFinalResults((prev) => ({
          ...prev,
          [question.id]: {
            scores: s,
            comment: payload.articleComment ?? "",
            thoughtFlow: payload.thoughtFlow ?? "",
            guide: payload.guideToThinkingGuide ?? DEFAULT_GUIDE_TEXT,
          },
        }));

        // 更新评分徽章为收尾综合分
        setFeedback((prev) => ({
          ...prev,
          [question.id]: {
            score: overall,
            analysis: prev[question.id]?.analysis ?? "",
          },
        }));

        // 自动完成该题
        void quizStorage.markCompleted(article.id, question.id);
        setQuestionStates((prev) => ({ ...prev, [question.id]: "completed" }));

        // 埋点：对话完成（含五维评分）
        void track("dialogue_completed", {
          article_id: article.id,
          question_id: question.id,
          overall_score: overall,
          independent_thinking: s.independent_thinking,
          evidence_quality: s.evidence_quality,
          logic_structure: s.logic_structure,
          word_precision: s.word_precision,
          reflection_depth: s.reflection_depth,
        });

        toast.success("对话完成，五维评分已生成！");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "发送失败，请重试";
      toast.error(message);
    } finally {
      setDialogueLoading((prev) => ({ ...prev, [question.id]: false }));
    }
  }

  // 结束对话
  function handleEndDialogue(question: ThinkingQuestion) {
    if (!article) return;
    void quizStorage.markCompleted(article.id, question.id);
    setQuestionStates((prev) => ({ ...prev, [question.id]: "completed" }));
    toast.success("这道题完成啦！");
  }

  // 语音输入回调
  const handleVoiceTranscript = useCallback(
    (questionId: string, text: string, isDialogue: boolean) => {
      if (isDialogue) {
        setDialogueInput((prev) => ({
          ...prev,
          [questionId]: (prev[questionId] ?? "") + text,
        }));
      } else {
        setAnswers((prev) => ({
          ...prev,
          [questionId]: (prev[questionId] ?? "") + text,
        }));
      }
    },
    []
  );

  // ===== 渲染 =====

  if (loading) {
    return (
      <main className="flex flex-col gap-4 px-4 pb-24 pt-4">
        <BackButton onClick={() => router.back()} />
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  if (error || !article) {
    return (
      <main className="flex flex-col gap-4 px-4 pb-24 pt-4">
        <BackButton onClick={() => router.back()} />
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {error ?? "文章不存在或已下架"}
          </CardContent>
        </Card>
      </main>
    );
  }

  const completedCount = Object.values(questionStates).filter(
    (s) => s === "completed"
  ).length;
  const totalQs = article.thinkingQuestions.length;
  const anyCompleted = totalQs > 0 && completedCount >= 1;

  return (
    <main className="flex flex-col gap-4 px-4 pb-24 pt-4">
      <BackButton onClick={() => router.back()} />

      {/* 文章内容 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl leading-snug">{article.title}</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={DIFFICULTY_VARIANT[article.difficulty]}>
              {article.difficulty}
            </Badge>
            <span className="flex items-center gap-1">
              <ClockIcon className="size-3" />
              {article.readingTime} 分钟
            </span>
            {article.source && <span>来源：{article.source}</span>}
          </div>
          {article.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {article.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">摘要</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {article.summary}
            </p>
          </div>
          {article.keyPoints.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">关键要点</h3>
              <ol className="flex flex-col gap-2">
                {article.keyPoints.map((point, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-relaxed">
                    <span className="font-medium text-muted-foreground">{i + 1}.</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 思考题区域 */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">思考题</h2>
          {totalQs > 0 && (
            <span className="text-xs text-muted-foreground">
              {completedCount}/{totalQs} 已完成
            </span>
          )}
        </div>

        {totalQs === 0 && (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              本篇文章暂无思考题。
            </CardContent>
          </Card>
        )}

        {article.thinkingQuestions.map((question) => {
          const state = questionStates[question.id] ?? "unanswered";
          const isAnalyzing = analyzing[question.id] ?? false;
          const currentFeedback = feedback[question.id];
          const messages = dialogueMessages[question.id] ?? [];
          const isDialogueLoading = dialogueLoading[question.id] ?? false;
          const currentDialogueInput = dialogueInput[question.id] ?? "";

          return (
            <Card key={question.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm leading-relaxed">
                    {question.question}
                  </CardTitle>
                  <Badge variant={DIMENSION_VARIANT[question.type]}>
                    {question.type}
                  </Badge>
                </div>
                {question.hint && state === "unanswered" && (
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <LightbulbIcon className="mt-0.5 size-3.5 shrink-0" />
                    <span>提示：{question.hint}</span>
                  </p>
                )}
              </CardHeader>

              <CardContent className="flex flex-col gap-3">
                {/* 未作答状态：显示输入框 */}
                {state === "unanswered" && (
                  <>
                    <div className="relative">
                      <Textarea
                        placeholder="写下你的想法…也可以点右下角麦克风用语音说"
                        value={answers[question.id] ?? ""}
                        onChange={(e) =>
                          setAnswers((prev) => ({
                            ...prev,
                            [question.id]: e.target.value,
                          }))
                        }
                        disabled={isAnalyzing}
                        className="min-h-24 pr-12"
                      />
                      <div className="absolute bottom-2 right-2">
                        <VoiceInput
                          onTranscript={(text) =>
                            handleVoiceTranscript(question.id, text, false)
                          }
                          disabled={isAnalyzing}
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={() => handleAnalyze(question)}
                        disabled={isAnalyzing}
                      >
                        {isAnalyzing ? (
                          <>
                            <Loader2Icon className="size-3.5 animate-spin" />
                            分析中…
                          </>
                        ) : (
                          "提交分析"
                        )}
                      </Button>
                    </div>
                  </>
                )}

                {/* 已分析但未对话：展示用户原始回答 + AI 反馈 + 开始对话按钮 */}
                {state === "analyzed" && currentFeedback && (
                  <>
                    {/* 用户原始回答 */}
                    <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                      <span className="text-xs font-medium text-blue-600">你的回答</span>
                      <p className="mt-1 text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                        {answers[question.id] ?? ""}
                      </p>
                    </div>

                    {/* AI 反馈（初次回答不评分，分数在 3 轮对话收尾时产生） */}
                    <div className="rounded-lg bg-muted/60 p-3">
                      <span className="text-xs font-medium text-muted-foreground">
                        AI 反馈
                      </span>
                      <AssessmentBlock text={currentFeedback.analysis} />
                    </div>
                    {/* 对话轮次预期提示（文档 v2.1 Prompt 2：进入追问对话前固定展示） */}
                    <div className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                      <LightbulbIcon className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                      <span>当下建议先进行五轮——你的初次回答算第 1 轮，之后还有 4 轮追问</span>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => startDialogue(question.id)}
                      >
                        继续深入对话
                      </Button>
                    </div>
                  </>
                )}

                {/* 对话中：显示对话消息 + 输入框 */}
                {state === "dialoguing" && (
                  <>
                    {/* 初次回答 + AI 初次反馈（保留可见，方便针对引导继续对话） */}
                    <div className="flex max-h-44 flex-col gap-2 overflow-y-auto">
                      <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                        <span className="text-xs font-medium text-blue-600">你的回答</span>
                        <p className="mt-1 text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                          {answers[question.id] ?? ""}
                        </p>
                      </div>
                      {currentFeedback && (
                        <div className="rounded-lg bg-muted/60 p-3">
                          <span className="text-xs font-medium text-muted-foreground">
                            AI 反馈
                          </span>
                          <AssessmentBlock text={currentFeedback.analysis} />
                        </div>
                      )}
                    </div>

                    {/* 轮次指示（共五轮：初次回答 + 4 轮追问；第 4 轮为总结性问题，回答后生成总结） */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {messages.filter((m) => m.role === "assistant").length >= 4
                          ? "总结问答轮 · 回答总结问题后生成思考总结"
                          : `第 ${Math.min(
                              messages.filter((m) => m.role === "assistant").length + 1,
                              4
                            )}/4 轮追问 · 共五轮（含初次回答）`}
                      </span>
                    </div>

                    {/* 对话消息列表 */}
                    {messages.length > 0 && (
                      <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
                        {messages.map((msg, i) => (
                          <div
                            key={i}
                            className={`flex ${
                              msg.role === "user" ? "justify-end" : "justify-start"
                            }`}
                          >
                            {/* assistant 消息：按输出字段分行展示（肯定 / 追问 各自成行） */}
                            {msg.role === "assistant" &&
                            msg.detail?.acknowledge &&
                            msg.detail?.followUpQuestion ? (
                              <div className="flex max-w-[85%] flex-col gap-1.5 rounded-lg bg-muted px-3 py-2">
                                <div className="flex items-start gap-1.5">
                                  <span className="mt-0.5 shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                                    肯定
                                  </span>
                                  <p className="text-sm leading-relaxed text-foreground">
                                    {msg.detail.acknowledge}
                                  </p>
                                </div>
                                <div className="flex items-start gap-1.5">
                                  <span className="mt-0.5 shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                                    {msg.detail.isSummaryQuestion ? "总结问题" : "追问"}
                                  </span>
                                  <p className="text-sm leading-relaxed text-foreground">
                                    {msg.detail.followUpQuestion}
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <div
                                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                                  msg.role === "user"
                                    ? "bg-blue-500 text-white"
                                    : "bg-muted text-foreground"
                                }`}
                              >
                                {msg.content}
                              </div>
                            )}
                          </div>
                        ))}
                        {isDialogueLoading && (
                          <div className="flex justify-start">
                            <div className="rounded-lg bg-muted px-3 py-2">
                              <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 对话输入框 */}
                    <div className="flex items-end gap-2">
                      <div className="relative flex-1">
                        <Textarea
                          placeholder="说说你的想法…"
                          value={currentDialogueInput}
                          onChange={(e) =>
                            setDialogueInput((prev) => ({
                              ...prev,
                              [question.id]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleSendDialogue(question);
                            }
                          }}
                          disabled={isDialogueLoading}
                          className="min-h-12 pr-10 text-sm"
                        />
                        <div className="absolute bottom-1.5 right-1.5">
                          <VoiceInput
                            onTranscript={(text) =>
                              handleVoiceTranscript(question.id, text, true)
                            }
                            disabled={isDialogueLoading}
                          />
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleSendDialogue(question)}
                        disabled={isDialogueLoading || !currentDialogueInput.trim()}
                      >
                        <SendIcon className="size-3.5" />
                      </Button>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEndDialogue(question)}
                      >
                        结束对话
                      </Button>
                    </div>
                  </>
                )}

                {/* 已完成状态 */}
                {state === "completed" && (
                  <>
                    {/* 用户初次回答（保留可见） */}
                    <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                      <span className="text-xs font-medium text-blue-600">你的回答</span>
                      <p className="mt-1 text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                        {answers[question.id] ?? ""}
                      </p>
                    </div>

                    {currentFeedback && (
                      <div className="rounded-lg bg-muted/60 p-3">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="ml-auto">
                            <CheckIcon className="size-3" />
                            已完成
                          </Badge>
                        </div>
                        <AssessmentBlock text={currentFeedback.analysis} />
                      </div>
                    )}

                    {messages.length > 0 && (
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer">
                          查看对话记录（{messages.length} 条）
                        </summary>
                        <div className="mt-2 flex flex-col gap-1.5">
                          {messages.map((msg, i) => (
                            <div
                              key={i}
                              className={`rounded px-2 py-1 ${
                                msg.role === "user"
                                  ? "bg-blue-50 text-right"
                                  : "bg-muted"
                              }`}
                            >
                              <span className="text-xs">
                                {msg.role === "user" ? "我" : "AI"}：{msg.content}
                              </span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* 总结轮收尾：在所有对话后作为总结内容展示
                        ① 思考流程图 ② 五维评分+总评（独立色块区分） ③ 思考指南引导 */}
                    {finalResults[question.id] && (
                      <div className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                        <div>
                          <span className="text-xs font-medium text-primary">
                            思考流程
                          </span>
                          <ThoughtFlowTree flow={finalResults[question.id].thoughtFlow} />
                        </div>
                        {/* ② 五维评分 + 总评：灰白黑色块，与流程图区分；最高分项黑底白字 */}
                        <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3">
                          <span className="text-xs font-medium text-gray-600">
                            五维评分
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {(() => {
                              const s = finalResults[question.id]!.scores;
                              const dims: Array<[string, number]> = [
                                ["独立思考", s.independent_thinking],
                                ["论据质量", s.evidence_quality],
                                ["逻辑条理", s.logic_structure],
                                ["用词精准", s.word_precision],
                                ["反思深度", s.reflection_depth],
                              ];
                              const maxScore = Math.max(...dims.map((d) => d[1]));
                              return dims.map(([label, v]) => (
                                <Badge
                                  key={label}
                                  className={
                                    v === maxScore
                                      ? "bg-black text-white"
                                      : "bg-gray-100 text-gray-900"
                                  }
                                >
                                  {label} {v}
                                </Badge>
                              ));
                            })()}
                          </div>
                          {finalResults[question.id].comment && (
                            <div className="flex items-start gap-1.5">
                              <span className="mt-0.5 shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-900">
                                总评
                              </span>
                              <p className="text-sm leading-relaxed text-foreground">
                                {finalResults[question.id].comment}
                              </p>
                            </div>
                          )}
                        </div>
                        {/* ③ 思考指南引导（不强制跳转，仅建议） */}
                        <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2">
                          <LightbulbIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
                          <p className="text-sm leading-relaxed text-amber-800">
                            {finalResults[question.id].guide || DEFAULT_GUIDE_TEXT}
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>

      {/* 全部完成的提示 */}
      {anyCompleted && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="flex items-center justify-center gap-2 py-4 text-sm text-green-700">
            <CheckIcon className="size-4" />
            完成任意一道思考题即算完成今日打卡！继续加油～
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="w-fit px-2">
      <ArrowLeftIcon className="size-4" />
      返回
    </Button>
  );
}
