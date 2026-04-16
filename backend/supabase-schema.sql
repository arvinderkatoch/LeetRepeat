-- Run this SQL in Supabase SQL Editor

create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text,
  google_sub text unique,
  created_at timestamptz not null default now()
);

alter table public.users alter column password_hash drop not null;
alter table public.users add column if not exists google_sub text;
create unique index if not exists users_google_sub_uidx on public.users(google_sub) where google_sub is not null;

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  link text not null,
  difficulty text not null check (difficulty in ('Easy', 'Medium', 'Hard')),
  status text not null default 'active' check (status in ('active', 'archived')),
  review_count int not null default 0,
  repetition int not null default 0,
  total_review_minutes int not null default 0,
  last_reviewed_at timestamptz,
  next_review_at date not null,
  interval_days int not null default 0,
  efactor numeric not null default 2.5,
  last_quality int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists questions_user_id_idx on public.questions(user_id);
create index if not exists questions_status_idx on public.questions(status);
create index if not exists questions_next_review_idx on public.questions(next_review_at);
