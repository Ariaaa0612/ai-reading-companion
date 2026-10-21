-- ============================================
-- AI 阅读伴侣 - Supabase 数据库表结构（Supabase Auth 版）
-- 在 Supabase Dashboard -> SQL Editor 中执行本文件
--
-- 本脚本会清空并重建 public 下的全部业务表（测试数据一并清除）。
-- 身份体系改为 Supabase Auth：所有 user_id 指向 auth.users(id)，
-- RLS 只允许登录用户读写自己的数据。
-- ============================================

-- ===== 0. 清空旧表（含旧的宽松策略） =====
drop table if exists public.events cascade;
drop table if exists public.weak_dimensions cascade;
drop table if exists public.assessments cascade;
drop table if exists public.chat_messages cascade;
drop table if exists public.quiz_answers cascade;
drop table if exists public.reading_records cascade;
drop table if exists public.user_plans cascade;
drop table if exists public.users cascade;

-- ===== 用户资料表（id 与 auth.users.id 一致） =====
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text unique not null,
  created_at timestamptz default now()
);

-- ===== 阅读计划 =====
create table public.user_plans (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  daily_goal int default 1,
  weekdays int[] default '{1,2,3,4,5}',
  reminder_time text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ===== 阅读打卡记录 =====
create table public.reading_records (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  article_id text not null,
  article_title text not null,
  date text not null,
  status text default 'completed',
  reading_time_seconds int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ===== 思考题回答 =====
create table public.quiz_answers (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  article_id text not null,
  question_id text not null,
  question_text text,
  dimension text not null,
  user_answer text not null,
  ai_analysis text,
  ai_score numeric default 0,
  final_scores jsonb,
  final_comment text,
  thought_flow text,
  dialogue_turns jsonb default '[]'::jsonb,
  completed boolean default false,
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- ===== 对话消息 =====
create table public.chat_messages (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  article_id text,
  role text not null,
  content text not null,
  created_at timestamptz default now()
);

-- ===== 测评结果 =====
create table public.assessments (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date text not null,
  dimension_scores jsonb not null,
  summary text,
  day_count int default 0,
  created_at timestamptz default now()
);

-- ===== 薄弱维度追踪 =====
create table public.weak_dimensions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  dimension text not null,
  baseline_score numeric not null,
  set_at timestamptz default now()
);

-- ===== 事件追踪表（埋点） =====
create table public.events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  nickname text,
  event_name text not null,
  event_properties jsonb,
  created_at timestamptz default now()
);

-- ===== 索引 =====
create index idx_reading_records_user_date on public.reading_records(user_id, date);
create index idx_quiz_answers_user on public.quiz_answers(user_id);
create index idx_quiz_answers_user_article on public.quiz_answers(user_id, article_id);
create index idx_assessments_user on public.assessments(user_id);
create index idx_weak_dimensions_user on public.weak_dimensions(user_id);
create index idx_events_user on public.events(user_id);
create index idx_events_name on public.events(event_name);

-- ===== 开启 RLS =====
alter table public.users enable row level security;
alter table public.user_plans enable row level security;
alter table public.reading_records enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.chat_messages enable row level security;
alter table public.assessments enable row level security;
alter table public.weak_dimensions enable row level security;
alter table public.events enable row level security;

-- ===== 策略：只能操作自己的数据 =====

-- users：id 就是 auth.uid()
create policy "users_select_own" on public.users
  for select to authenticated using (auth.uid() = id);
create policy "users_insert_own" on public.users
  for insert to authenticated with check (auth.uid() = id);
create policy "users_update_own" on public.users
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- user_plans
create policy "plans_select_own" on public.user_plans
  for select to authenticated using (auth.uid() = user_id);
create policy "plans_insert_own" on public.user_plans
  for insert to authenticated with check (auth.uid() = user_id);
create policy "plans_update_own" on public.user_plans
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "plans_delete_own" on public.user_plans
  for delete to authenticated using (auth.uid() = user_id);

-- reading_records
create policy "records_select_own" on public.reading_records
  for select to authenticated using (auth.uid() = user_id);
create policy "records_insert_own" on public.reading_records
  for insert to authenticated with check (auth.uid() = user_id);
create policy "records_update_own" on public.reading_records
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "records_delete_own" on public.reading_records
  for delete to authenticated using (auth.uid() = user_id);

-- quiz_answers
create policy "quiz_select_own" on public.quiz_answers
  for select to authenticated using (auth.uid() = user_id);
create policy "quiz_insert_own" on public.quiz_answers
  for insert to authenticated with check (auth.uid() = user_id);
create policy "quiz_update_own" on public.quiz_answers
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "quiz_delete_own" on public.quiz_answers
  for delete to authenticated using (auth.uid() = user_id);

-- chat_messages
create policy "chat_select_own" on public.chat_messages
  for select to authenticated using (auth.uid() = user_id);
create policy "chat_insert_own" on public.chat_messages
  for insert to authenticated with check (auth.uid() = user_id);
create policy "chat_update_own" on public.chat_messages
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "chat_delete_own" on public.chat_messages
  for delete to authenticated using (auth.uid() = user_id);

-- assessments
create policy "assess_select_own" on public.assessments
  for select to authenticated using (auth.uid() = user_id);
create policy "assess_insert_own" on public.assessments
  for insert to authenticated with check (auth.uid() = user_id);
create policy "assess_update_own" on public.assessments
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "assess_delete_own" on public.assessments
  for delete to authenticated using (auth.uid() = user_id);

-- weak_dimensions
create policy "weak_select_own" on public.weak_dimensions
  for select to authenticated using (auth.uid() = user_id);
create policy "weak_insert_own" on public.weak_dimensions
  for insert to authenticated with check (auth.uid() = user_id);
create policy "weak_update_own" on public.weak_dimensions
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "weak_delete_own" on public.weak_dimensions
  for delete to authenticated using (auth.uid() = user_id);

-- events：只允许写自己的记录，读取也仅限自己
create policy "events_insert_own" on public.events
  for insert to authenticated with check (auth.uid() = user_id);
create policy "events_select_own" on public.events
  for select to authenticated using (auth.uid() = user_id);
