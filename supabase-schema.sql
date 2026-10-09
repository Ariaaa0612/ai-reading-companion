-- ============================================
-- AI 阅读伴侣 - Supabase 数据库表结构
-- 在 Supabase Dashboard -> SQL Editor 中执行此文件
-- ============================================

-- ===== 用户表（昵称登录） =====
create table if not exists public.users (
  id uuid default gen_random_uuid() primary key,
  nickname text unique not null,
  created_at timestamptz default now()
);

-- ===== 阅读计划 =====
create table if not exists public.user_plans (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade,
  daily_goal int default 1,
  weekdays int[] default '{1,2,3,4,5}',
  reminder_time text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ===== 阅读打卡记录 =====
create table if not exists public.reading_records (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade,
  article_id text not null,
  article_title text not null,
  date text not null,
  status text default 'completed',
  reading_time_seconds int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ===== 思考题回答 =====
create table if not exists public.quiz_answers (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade,
  article_id text not null,
  question_id text not null,
  question_text text,
  dimension text not null,
  user_answer text not null,
  ai_analysis text,
  ai_score numeric default 0,
  final_scores jsonb,          -- 第 3 轮收尾五维评分（independent_thinking 等 5 个 0-10 整数）
  final_comment text,          -- 收尾总评（≤50 字）
  thought_flow text,           -- 思考流程图（第 3 轮收尾输出）
  dialogue_turns jsonb default '[]'::jsonb,
  completed boolean default false,
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- 存量库升级（已建表的执行此段即可，幂等）
alter table public.quiz_answers add column if not exists final_scores jsonb;
alter table public.quiz_answers add column if not exists final_comment text;
alter table public.quiz_answers add column if not exists thought_flow text;

-- ===== 对话消息 =====
create table if not exists public.chat_messages (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade,
  article_id text,
  role text not null,
  content text not null,
  created_at timestamptz default now()
);

-- ===== 测评结果 =====
create table if not exists public.assessments (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade,
  date text not null,
  dimension_scores jsonb not null,
  summary text,
  day_count int default 0,
  created_at timestamptz default now()
);

-- ===== 薄弱维度追踪 =====
create table if not exists public.weak_dimensions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade,
  dimension text not null,
  baseline_score numeric not null,
  set_at timestamptz default now()
);

-- ===== 事件追踪表（埋点用，暂时不用但先建好） =====
create table if not exists public.events (
  id bigint generated always as identity primary key,
  user_id uuid references public.users(id) on delete set null,
  nickname text,
  event_name text not null,
  event_properties jsonb,
  created_at timestamptz default now()
);

-- ===== 索引 =====
create index if not exists idx_reading_records_user_date on public.reading_records(user_id, date);
create index if not exists idx_quiz_answers_user on public.quiz_answers(user_id);
create index if not exists idx_quiz_answers_user_article on public.quiz_answers(user_id, article_id);
create index if not exists idx_assessments_user on public.assessments(user_id);
create index if not exists idx_weak_dimensions_user on public.weak_dimensions(user_id);
create index if not exists idx_events_user on public.events(user_id);
create index if not exists idx_events_name on public.events(event_name);

-- ===== RLS 策略（行级安全） =====
-- MVP 阶段：所有表允许匿名读写（通过 publishable key）
-- 上线后应收紧为仅登录用户可操作自己的数据

alter table public.users enable row level security;
alter table public.user_plans enable row level security;
alter table public.reading_records enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.chat_messages enable row level security;
alter table public.assessments enable row level security;
alter table public.weak_dimensions enable row level security;
alter table public.events enable row level security;

-- MVP 阶段：允许所有操作（anon role）
create policy "public_read_users" on public.users for select to anon using (true);
create policy "public_insert_users" on public.users for insert to anon with check (true);

create policy "public_all_plans" on public.user_plans for all to anon using (true) with check (true);
create policy "public_all_records" on public.reading_records for all to anon using (true) with check (true);
create policy "public_all_quiz" on public.quiz_answers for all to anon using (true) with check (true);
create policy "public_all_chat" on public.chat_messages for all to anon using (true) with check (true);
create policy "public_all_assessments" on public.assessments for all to anon using (true) with check (true);
create policy "public_all_weak" on public.weak_dimensions for all to anon using (true) with check (true);
create policy "public_all_events" on public.events for all to anon using (true) with check (true);
