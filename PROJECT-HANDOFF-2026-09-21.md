# 项目交接文档（2026-09-21 · badcase 修改阶段）

## 项目概况
- **AI 阅读陪伴应用**：Next.js 16 + TypeScript + Tailnd + shadcn/ui，AI 后端 DeepSeek，数据 Supabase（备份通道）+ localStorage（主存储）
- **根目录**：`C:\Users\初昕\AppData\Roaming\TRAE SOLO CN\ModularData\ai-agent\work-mode-projects\6aa39ea4cb369e66977f2121\ai-reading-companion`
- **核心流程**：登录（昵称即账号）→ 每日文章列表 → 文章思考题初答（Prompt 1 评分）→ 5 轮对话（Prompt 2：初答 + 3 次追问 + 第 4 轮总结性问题 + 第 5 轮总结收尾）→ 思考流程树/五维评分 → 首日打卡解锁测评（Prompt 3，未接前端入口）
- **每日文章**：TRAE 定时任务每天 11:00 生成到 `daily-articles/`，另有基准文章「延迟满足与长期主义」（20260913-006）代码级固定追加在每日列表末位

## 关键文件
| 文件 | 职责 |
|------|------|
| `src/lib/prompts/scoring.ts` | Prompt 1 初答评估（v2.1 已对齐，**冻结不改**） |
| `src/lib/prompts/dialogue.ts` | Prompt 2 五轮对话（badcase 修改主战场） |
| `src/lib/prompts/guide.ts` | Prompt 3（旧版结构，**暂不动**） |
| `src/lib/ai-validators.ts` | AI 输出校验（assessment 长度 20-310、追问单问号自动截断、敷衍跳过优点检查） |
| `src/app/api/quiz/analyze/route.ts` | 初答接口（含敷衍前置拦截） |
| `src/app/api/chat/route.ts` | 对话接口（round 由 history 用户轮数+1 推导；兜底模板按轮次） |
| `src/app/article/[id]/page.tsx` | 文章页：初答 → 对话（气泡带「肯定/追问/总结问题」标签）→ 完成态总结卡片（思考流程树 + 灰白黑五维评分板块 + 引导语） |
| `src/app/page.tsx` | 主页：右上角「昵称+退出」（logout 清登录态 2 项 + 业务 6 项） |
| `src/lib/storage.ts` | localStorage 主存储（`arc_*` 前缀，**不按用户隔离**） |
| `DEV-LOG-*.md` | 每日开发日志（09-11 至 09-17），历史决策都在里面 |

## 当前对话链路（Prompt 2 最新版）
- 共 5 轮：初答 → 追问1（挖论据）→ 追问2（挖反思）→ 追问3（迁移检验）→ 追问4（总结性问题，普通追问格式，`is_final_round=false`）→ 用户回答 → 第 5 轮总结输出（acknowledge 肯定 + thought_flow + article_scores 五维 + article_comment + 引导语，`follow_up_question` 空串）
- thought_flow 格式：`用户思考路径流程图：` + `┌─ 起点：内容概括（逻辑链路）` 树形行，括号按「表达观点→补充论据→深化反思→迁移检验→总结沉淀」链路标注；前端 `parseThoughtFlow`/`ThoughtFlowTree`（page.tsx:63-120）解析为竖向节点树，当前/总结节点高亮
- 引导语固定文案：「想看你在本阶段的整体思考能力变化，可以去测评的「思考指南」」

## 已完成的重要修复（不要回退）
- 五维评分类目 = 独立思考/论据质量/逻辑条理/用词精准/反思深度；第 5 轮评分前端已消费并落库（quiz_answers 表有 final_scores/final_comment/thought_flow 列，**Supabase 需手动执行过 ALTER，确认已做**）
- 敷衍评估跳过「必须有优点」校验；违禁词已修复单字误报（牛顿/梗概）；问号自动截断
- 测评解锁：3 天 → 1 天（首次打卡即解锁）
- 「AI 评分 0/10」展示已删；五维评分板块灰白黑配色（白底、灰条黑字、最高分黑底白字）

## 已知未决问题（badcase 候选）
1. **TRAE 内置预览跨源问题**：预览经 traecontent.cn 代理 → dev server 拦截跨源 POST → 页面显示「AI 服务暂时不可用」；退出按钮的 `window.confirm` 在预览里也不可用（曾触发 TRAE webview React #185 崩溃）。**测试一律用真浏览器访问 `http://localhost:3000`**。修复方向：allowedDevOrigins 加实际代理源 + confirm 改内联两步确认
2. dev server 是后台进程，关机/会话结束即停，重启命令：`npx next dev --turbopack -p 3000`（在项目根目录）
3. 存量遗留：`aiScore` 恒 0（刷新后徽章无分数）、Prompt 3 旧结构未升级 v2.1、RLS 全开（anon 可任意读写删）、`syncAllFromCloud` 禁用（数据只备份不恢复）
4. 今日文章偶发定时任务未产出（09-17 出现过一次，手动补跑解决）

## 测试与数据规约
- **20 用例测试法**：每条用例 = 主页退出 → 新昵称登录 → 测（浏览器全清，云端按昵称归档，互不污染）
- 单文章重置书签（清当前文章 localStorage 数据）已在用户浏览器配置
- badcase 修改后回归脚本：`scripts/test-dialogue-3rounds.ps1`（5 轮真实 API）
- 测完从云端按昵称拉记录复盘 → 全量备份 → 清库（users/quiz_answers/reading_records/assessments 全表）→ 清浏览器 localStorage → pilot
- 备份文件：`backups/supabase-backup-2026-09-13.json`

## API 请求体速查（字段名易错）
- 初答 `/api/quiz/analyze`：`articleId, questionId, questionText, dimension, userAnswer, articleTitle?, articleSummary?, checkInDays?`
- 对话 `/api/chat`：`message, articleTitle, articleSummary, articleKeyPoints, questionText, dimension, firstAnswer, dialogueHistory[{role,content}], checkInDays`（无 round 字段，由 history 推导）

## 用户偏好
- 中文交流；先评估确认再执行；重大改动后写 DEV-LOG（`DEV-LOG-YYYY-MM-DD.md` 按日追加）
- Prompt 1 已冻结；Prompt 3 暂不动；badcase 阶段只改 Prompt 2 及相关链路
- 兜底机制（DeepSeek 挂掉走固定模板）是文档要求的设计，不是缺陷
