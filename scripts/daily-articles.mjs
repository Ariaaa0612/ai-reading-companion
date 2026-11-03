/**
 * 每日 AI 资讯生成脚本
 *
 * 流程：抓取多个 RSS 源 → 过滤近 48 小时内容 → 交给 DeepSeek 结构化加工 → 校验 → 写入 daily-articles/YYYY-MM-DD.json
 *
 * 设计原则（保证长期稳定）：
 * 1. 幂等：当天文件已存在且合法则直接跳过，不覆盖、不重复提交
 * 2. 只增不删：只写当天文件，历史文件永不移除
 * 3. 失败兜底：AI 加工失败时用 RSS 原文摘要生成可用内容，保证每天都有更新
 * 4. 严格校验：输出必须通过结构校验才会落盘，避免污染前端
 * 5. 无第三方依赖：只使用 Node 内置能力，避免依赖升级导致构建失败
 *
 * 用法：
 *   node scripts/daily-articles.mjs                # 正常运行（需要 DEEPSEEK_API_KEY）
 *   node scripts/daily-articles.mjs --dry-run      # 不调 AI，用原文摘要兜底，仅用于本地联通性验证
 *   node scripts/daily-articles.mjs --force        # 忽略"当天已存在"直接重跑
 *   node scripts/daily-articles.mjs --date=2026-10-29
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'daily-articles')

// ===== 配置 =====

/** 资讯源。general=true 表示综合科技源，需要关键词过滤后才能入选 */
const SOURCES = [
  { name: '量子位', url: 'https://www.qbitai.com/feed', general: false },
  { name: 'TechCrunch', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', general: false },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', general: false },
  { name: 'IT之家', url: 'https://www.ithome.com/rss/', general: true },
]

/** 综合源里标题命中这些词才认为与 AI 相关（只放主题词，公司名太容易误判，例如"微软鼠标"） */
const AI_KEYWORDS = [
  'AI', 'A.I.', '人工智能', '大模型', '智能体', 'Agent', '机器人', '具身智能',
  'GPU', '机器学习', '深度学习', '生成式', '多模态', '算法',
  'OpenAI', 'Anthropic', 'ChatGPT', 'Claude', 'Gemini', 'DeepSeek', '通义', '文心', 'Kimi',
]

/** 最多保留多少条候选交给 AI 挑选（控制 token 成本） */
const MAX_CANDIDATES = 14
/** 最终每天产出的文章数 */
const TARGET_COUNT = 5
/** 少于这个数量则判定当日失败，不提交 */
const MIN_COUNT = 3
/** 只接受多少小时内的新闻 */
const FRESH_HOURS = 48

const DIMENSIONS = ['理解力', '批判性思维', '联想力', '表达力', '反思力']
const DIFFICULTIES = ['入门', '进阶', '深度']

// ===== 命令行参数 =====

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const FORCE = args.includes('--force')
const DATE_ARG = (args.find((a) => a.startsWith('--date=')) || '').split('=')[1]

/** 北京时间的今天（GitHub Actions runner 是 UTC，必须显式换算） */
function todayInShanghai() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
}

function log(...a) {
  console.log(`[${new Date().toISOString()}]`, ...a)
}

// ===== 抓取与解析 =====

async function fetchText(url, attempt = 1) {
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; daily-articles-bot/1.0)',
        accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } catch (e) {
    if (attempt >= 3) throw e
    log(`  重试 ${attempt}/3：${url}（${e.message}）`)
    await new Promise((r) => setTimeout(r, attempt * 3000))
    return fetchText(url, attempt + 1)
  }
}

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function stripHtml(s) {
  return decodeEntities(String(s || ''))
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 解析 RSS 2.0 / Atom，返回统一结构的条目 */
function parseFeed(xml, sourceName) {
  const blocks =
    xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []

  return blocks
    .map((block) => {
      const pick = (tags) => {
        for (const t of tags) {
          const m = block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i'))
          if (m && m[1].trim()) return m[1].trim()
        }
        return ''
      }
      const title = stripHtml(pick(['title']))
      // Atom 的 link 是属性形式
      const linkAttr = block.match(/<link[^>]*href=["']([^"']+)["']/i)
      const link = stripHtml(pick(['link'])) || (linkAttr ? linkAttr[1] : '')
      const desc = stripHtml(pick(['description', 'summary', 'content:encoded', 'content']))
      const dateRaw = stripHtml(pick(['pubDate', 'published', 'updated', 'dc:date']))
      const ts = Date.parse(dateRaw)
      return {
        title,
        url: link,
        desc,
        ts: Number.isNaN(ts) ? 0 : ts,
        source: sourceName,
      }
    })
    .filter((x) => x.title && x.url)
}

function isAI(item) {
  // 综合科技源噪音很多（鼠标、路由器也算"芯片"），所以关键词必须出现在标题里才算 AI 新闻
  const title = String(item.title).toLowerCase()
  return AI_KEYWORDS.some((k) => title.includes(k.toLowerCase()))
}

function normalizeTitle(t) {
  return t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
    .slice(0, 40)
}

async function collectCandidates() {
  const cutoff = Date.now() - FRESH_HOURS * 3600 * 1000
  const items = []

  for (const src of SOURCES) {
    try {
      const xml = await fetchText(src.url)
      const parsed = parseFeed(xml, src.name)
      const fresh = parsed.filter((x) => !x.ts || x.ts >= cutoff)
      const relevant = src.general ? fresh.filter(isAI) : fresh
      log(`  ${src.name}: ${parsed.length} 条，可用 ${relevant.length} 条`)
      items.push(...relevant)
    } catch (e) {
      log(`  ${src.name}: 抓取失败（${e.message}），跳过该源`)
    }
  }

  // 去重 + 按时间倒序
  const seen = new Set()
  const unique = []
  for (const it of items.sort((a, b) => b.ts - a.ts)) {
    const key = normalizeTitle(it.title)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(it)
  }

  return unique.slice(0, MAX_CANDIDATES)
}

// ===== 正文抓取：RSS 只有摘要，补一层页面正文，质量才接近人工编辑 =====

const UA =
  'Mozilla/5.0 (compatible; ai-reading-companion-bot/1.0; +https://xianglexiang.cn)'

async function fetchArticleText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(12000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()
  const text = stripHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ''),
  )
  return text.length >= 200 ? text.slice(0, 1800) : ''
}

/** 并发抓正文，单篇失败不影响整体；抓不到就退回 RSS 摘要 */
async function enrichWithBody(candidates) {
  const out = []
  const CONCURRENCY = 4
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY)
    const enriched = await Promise.all(
      batch.map(async (c) => {
        try {
          const body = await fetchArticleText(c.url)
          return body ? { ...c, body } : c
        } catch (e) {
          return c
        }
      }),
    )
    out.push(...enriched)
  }
  const got = out.filter((c) => c.body).length
  log(`正文抓取：${got}/${out.length} 篇拿到全文，其余用摘要`)
  return out
}

// ===== AI 加工 =====

function buildPrompt(candidates, date) {
  const list = candidates
    .map((c, i) => {
      const lines = [`${i + 1}. [${c.source}] ${c.title}`, `   URL: ${c.url}`]
      lines.push(c.body ? `   正文：${c.body}` : `   简介: ${c.desc.slice(0, 300)}`)
      return lines.join('\n')
    })
    .join('\n\n')

  return `你是「AI 阅读陪伴应用」的内容编辑。请从下面这批今日候选新闻中，挑出最适合普通人阅读学习的 ${TARGET_COUNT} 篇，改写为结构化内容。

候选新闻（只能从这里选，不得编造）：
${list}

写作要求：
- 面向普通大众，不是专业人士。中文写作，英文来源要翻译成中文。
- summary：200~300 字，讲清楚"发生了什么、为什么重要、对普通人意味着什么"，不要堆术语。
- keyPoints：3~4 条，每条一句话，具体有信息量。
- thinkingQuestions：每篇 1~2 道，必须说人话，用日常用语；专业术语要换成通俗说法（例如"审批门控"→"只有被批准的公司才能用"）；每题只能有一个问号；紧贴文章具体内容，不要泛泛而谈；hint 用大白话给一句思考提示。
- type 只能取：理解力、批判性思维、联想力、表达力、反思力，尽量覆盖不同维度。
- difficulty 只能取：入门、进阶、深度。
- readingTime 是整数，3~8（分钟）。
- tags 2~3 个短标签。
- trendCommentary：60~120 字，2~3 句话，总结今天这批 news 的整体趋势；必须是顶层字段，不能省略。
- sourceUrl 必须原样使用候选里给出的 URL；source 用候选里的来源名。

严格输出 JSON，不要任何解释文字、不要代码块标记，结构如下：
{
  "date": "${date}",
  "articles": [
    {
      "id": "${date.replace(/-/g, '')}-001",
      "title": "标题",
      "summary": "摘要",
      "keyPoints": ["要点"],
      "source": "来源名",
      "sourceUrl": "候选里的 URL",
      "tags": ["标签"],
      "readingTime": 5,
      "difficulty": "入门",
      "thinkingQuestions": [{ "id": "q1", "question": "只有一题的思考题？", "type": "理解力", "hint": "提示" }]
    }
  ],
  "trendCommentary": "趋势点评"
}`
}

async function callDeepSeek(candidates, date) {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) {
    log('::warning::未配置 DEEPSEEK_API_KEY，本次改用原文摘要兜底（内容可用但未经 AI 加工）')
    const err = new Error('缺少 DEEPSEEK_API_KEY')
    err.noRetry = true
    throw err
  }
  const base = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          messages: [{ role: 'user', content: buildPrompt(candidates, date) }],
          temperature: 0.4,
          max_tokens: 8000,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(180000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
      const json = await res.json()
      const content = json?.choices?.[0]?.message?.content || ''
      return JSON.parse(extractJson(content))
    } catch (e) {
      log(`  AI 第 ${attempt} 次失败：${e.message}`)
      if (attempt === 2) throw e
    }
  }
}

function extractJson(text) {
  const cleaned = String(text).replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('AI 返回内容里找不到 JSON')
  return cleaned.slice(start, end + 1)
}

// ===== 兜底：AI 不可用时用原文摘要拼出可用内容 =====

/** 兜底要点：从原文摘要里切句子，不足 2 条时用通用要点补齐 */
function buildFallbackPoints(c) {
  const points = c.desc
    .split(/[。！？!?]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8)
    .slice(0, 3)
    .map((s) => (s.endsWith('。') ? s : `${s}。`))

  if (points.length < 2) {
    points.push(`消息来自${c.source}，原标题：${c.title}。`)
  }
  if (points.length < 2) {
    points.push('完整细节可查看文末原文链接。')
  }
  return points.slice(0, 3)
}

function fallbackArticles(candidates, date) {
  const stamp = date.replace(/-/g, '')
  const picked = candidates.slice(0, TARGET_COUNT).map((c, i) => {
    const summary = c.desc.length >= 120 ? c.desc.slice(0, 280) : `${c.title}。${c.desc}`
    return {
      id: `${stamp}-${String(i + 1).padStart(3, '0')}`,
      title: c.title,
      summary,
      keyPoints: buildFallbackPoints(c),
      source: c.source,
      sourceUrl: c.url,
      tags: ['AI', '行业动态'],
      readingTime: Math.min(8, Math.max(3, Math.round(summary.length / 120))),
      difficulty: '入门',
      thinkingQuestions: [
        {
          id: 'q1',
          question: '这条新闻里，最让你意外的变化是什么？',
          type: '理解力',
          hint: '先从文章里找出最关键的一件事，再想想它和以前有什么不同。',
        },
      ],
    }
  })

  return {
    date,
    articles: picked,
    trendCommentary: '今日 AI 领域继续围绕模型能力、产业落地和资本动作推进，值得留意的是这些变化正在更快地传导到普通人的日常选择上。',
  }
}

// ===== 校验与规范化 =====

function validate(data, date, candidates) {
  const errs = []
  if (!data || typeof data !== 'object') return { ok: false, errs: ['不是对象'] }
  if (data.date !== date) errs.push(`date 不符：${data.date}`)
  if (!Array.isArray(data.articles)) return { ok: false, errs: ['articles 不是数组'] }
  if (data.articles.length < MIN_COUNT) errs.push(`文章数不足：${data.articles.length}`)

  const urls = new Set(candidates.map((c) => c.url))
  const stamp = date.replace(/-/g, '')

  data.articles = data.articles.slice(0, TARGET_COUNT).map((a, i) => {
    if (!a || typeof a !== 'object') {
      errs.push(`第 ${i + 1} 篇不是对象`)
      return null
    }
    const out = { ...a }
    out.id = /^\d{8}-\d{3}$/.test(a.id || '') ? a.id : `${stamp}-${String(i + 1).padStart(3, '0')}`
    if (!a.title || typeof a.title !== 'string') errs.push(`第 ${i + 1} 篇缺少 title`)
    out.title = String(a.title || '').trim()
    out.summary = String(a.summary || '').trim()
    if (out.summary.length < 40) errs.push(`第 ${i + 1} 篇 summary 过短`)
    out.keyPoints = (Array.isArray(a.keyPoints) ? a.keyPoints : [])
      .map((k) => String(k).trim())
      .filter(Boolean)
      .slice(0, 4)
    if (out.keyPoints.length < 2) errs.push(`第 ${i + 1} 篇 keyPoints 不足`)
    out.source = String(a.source || '网络').trim()
    out.sourceUrl = String(a.sourceUrl || '').trim()
    if (!/^https?:\/\//.test(out.sourceUrl)) {
      // AI 偶尔会漏 URL，用标题在候选里回查
      const hit = candidates.find((c) => normalizeTitle(c.title) === normalizeTitle(out.title))
      out.sourceUrl = hit ? hit.url : [...urls][0] || ''
    }
    if (!out.sourceUrl) errs.push(`第 ${i + 1} 篇缺少 sourceUrl`)
    out.tags = (Array.isArray(a.tags) ? a.tags : ['AI']).map((t) => String(t).trim()).filter(Boolean).slice(0, 3)
    const rt = Number(a.readingTime)
    out.readingTime = Number.isFinite(rt) ? Math.min(8, Math.max(3, Math.round(rt))) : 5
    out.difficulty = DIFFICULTIES.includes(a.difficulty) ? a.difficulty : '入门'
    const qs = (Array.isArray(a.thinkingQuestions) ? a.thinkingQuestions : [])
      .map((q, qi) => ({
        id: `q${qi + 1}`,
        question: String(q?.question || '').trim(),
        type: DIMENSIONS.includes(q?.type) ? q.type : '理解力',
        hint: String(q?.hint || '').trim(),
      }))
      .filter((q) => q.question)
      .slice(0, 2)
    if (qs.length === 0) errs.push(`第 ${i + 1} 篇没有思考题`)
    out.thinkingQuestions = qs
    return out
  }).filter(Boolean)

  data.trendCommentary = String(data.trendCommentary || '').trim()
  if (data.trendCommentary.length < 20) {
    // AI 偶尔漏写这段；不值得为一段点评丢弃整份 AI 加工稿，用兜底句补上
    data.trendCommentary = '今日 AI 领域的进展集中在模型能力、产品落地与资本动作上，这些变化正在更快地传导到普通人的日常选择。'
    log('AI 漏写 trendCommentary，已用兜底句补上（保留 AI 加工正文）')
  }

  return { ok: errs.length === 0, errs }
}

// ===== 主流程 =====

async function main() {
  const date = DATE_ARG || todayInShanghai()
  const outFile = path.join(OUT_DIR, `${date}.json`)
  log(`目标日期：${date}（北京时间）`)

  if (fs.existsSync(outFile) && !FORCE) {
    log(`当天文件已存在，跳过：${outFile}`)
    return
  }

  log('抓取资讯源…')
  let candidates = await collectCandidates()
  log(`候选总数：${candidates.length}`)
  if (candidates.length < MIN_COUNT) {
    throw new Error(`候选不足 ${MIN_COUNT} 条，今日不产出（保留历史内容）`)
  }

  log('抓取候选正文…')
  candidates = await enrichWithBody(candidates)

  let data
  if (DRY_RUN) {
    log('dry-run：跳过 AI，使用原文摘要兜底')
    data = fallbackArticles(candidates, date)
  } else {
    try {
      log('调用 DeepSeek 加工…')
      data = await callDeepSeek(candidates, date)
    } catch (e) {
      log(`AI 加工失败（${e.message}），改用原文摘要兜底，保证当天有内容`)
      data = fallbackArticles(candidates, date)
    }
  }

  const { ok, errs } = validate(data, date, candidates)
  if (!ok) {
    log('AI 输出校验未通过：')
    errs.forEach((e) => log(`  - ${e}`))
    log('尝试兜底内容…')
    data = fallbackArticles(candidates, date)
    const retry = validate(data, date, candidates)
    if (!retry.ok) {
      retry.errs.forEach((e) => log(`  - ${e}`))
      throw new Error('兜底内容仍未通过校验，中止，不写入文件')
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const tmp = `${outFile}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
  fs.renameSync(tmp, outFile)

  log(`已写入 ${path.relative(ROOT, outFile)}（${data.articles.length} 篇）`)
  data.articles.forEach((a) => log(`  · ${a.title}`))
}

main().catch((e) => {
  log(`失败：${e.message}`)
  process.exit(1)
})
