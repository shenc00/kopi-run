-- ============================================================
-- Kopi Run — Supabase schema
-- Run this in your Supabase project: SQL Editor > New query > paste > Run
-- ============================================================

create extension if not exists pgcrypto;

-- One row per order session. `code` is the short share code in the URL.
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,
  name            text not null,
  closed          boolean not null default false,
  organizer_token text not null,
  created_at      timestamptz not null default now()
);

-- One row per drink ordered by a person.
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  person      text not null,
  drink       text not null,
  notes       text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists items_order_id_idx on public.items(order_id);

-- ---------------- Paywall (built dormant — see is_entitled() below) ----------------
-- Single-row kill switch. While false, is_entitled() always returns true and
-- every policy below behaves exactly like the old MVP "anyone with the code"
-- rules. Flip to true (UPDATE public.config SET paywall_enabled = true) to
-- activate — no app redeploy needed.
create table if not exists public.config (
  id              boolean primary key default true,
  paywall_enabled boolean not null default false,
  constraint config_singleton check (id)
);
insert into public.config (id, paywall_enabled) values (true, false) on conflict (id) do nothing;

-- One row per Supabase auth user (anonymous or not). trial_started_at is set
-- once, at signup, by the trigger below — the app never writes it directly.
create table if not exists public.entitlements (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  trial_started_at  timestamptz not null default now(),
  purchased         boolean not null default false,
  purchase_token    text,
  purchased_at      timestamptz
);

alter table public.entitlements enable row level security;
drop policy if exists entitlements_select on public.entitlements;
drop policy if exists entitlements_insert on public.entitlements;
create policy entitlements_select on public.entitlements for select using (auth.uid() = user_id);
-- Row is created by the trigger (security definer), not by client inserts —
-- no insert policy needed for anon/authenticated.

-- Creates the entitlements row the moment a user (anonymous or real) signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.entitlements (user_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- True when the paywall is off, or the caller has purchased, or is still
-- within their 7-day trial. No row (e.g. anon/service-role caller with no
-- session) reads as not entitled once the paywall is live.
create or replace function public.is_entitled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    not (select paywall_enabled from public.config where id = true)
    or coalesce(
      (select purchased or now() < trial_started_at + interval '7 days'
         from public.entitlements
        where user_id = auth.uid()),
      false
    );
$$;

grant execute on function public.is_entitled() to anon, authenticated;

-- ---------------- Row Level Security ----------------
alter table public.orders enable row level security;
alter table public.items  enable row level security;

-- MVP policies (no login): anyone with the code can read and add, gated by
-- is_entitled() — a no-op while paywall_enabled is false.
-- Closing an order does NOT go through a direct UPDATE — it uses the
-- close_order() function below, which checks the organizer token.
drop policy if exists orders_select on public.orders;
drop policy if exists orders_insert on public.orders;
drop policy if exists items_select  on public.items;
drop policy if exists items_insert  on public.items;
drop policy if exists items_update  on public.items;
drop policy if exists items_delete  on public.items;

create policy orders_select on public.orders for select using (is_entitled());
create policy orders_insert on public.orders for insert with check (is_entitled());
create policy items_select  on public.items  for select using (is_entitled());
create policy items_insert  on public.items  for insert with check (is_entitled());
-- Like insert, edit/delete are open at the DB level (link-based, no login).
-- The app limits the buttons to the drinks a device added, plus the organizer.
create policy items_update  on public.items  for update using (is_entitled()) with check (is_entitled());
create policy items_delete  on public.items  for delete using (is_entitled());

-- ---------------- Close order (organizer only) ----------------
-- Runs with elevated rights but only flips `closed` when the supplied
-- token matches the one stored when the order was created.
create or replace function public.close_order(p_code text, p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
     set closed = true
   where code = p_code
     and organizer_token = p_token;
end;
$$;

grant execute on function public.close_order(text, text) to anon, authenticated;

-- ---------------- Realtime ----------------
-- Lets the app receive live INSERT/UPDATE events over websockets.
-- Guarded so re-running the schema doesn't error if the tables are already
-- members of the publication ("already member of publication" / 42710).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'items'
  ) then
    alter publication supabase_realtime add table public.items;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

-- ---------------- Data API grants ----------------
-- Future-proofing: from late 2026 Supabase requires explicit grants for
-- the Data API to see tables. Granting now keeps things working either way.
grant select, insert on public.orders to anon, authenticated;
grant select, insert, update, delete on public.items  to anon, authenticated;
grant select on public.entitlements to anon, authenticated;
grant select on public.config to anon, authenticated;
