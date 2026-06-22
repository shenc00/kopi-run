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

-- ---------------- Row Level Security ----------------
alter table public.orders enable row level security;
alter table public.items  enable row level security;

-- MVP policies (no login): anyone with the code can read and add.
-- Closing an order does NOT go through a direct UPDATE — it uses the
-- close_order() function below, which checks the organizer token.
drop policy if exists orders_select on public.orders;
drop policy if exists orders_insert on public.orders;
drop policy if exists items_select  on public.items;
drop policy if exists items_insert  on public.items;
drop policy if exists items_update  on public.items;
drop policy if exists items_delete  on public.items;

create policy orders_select on public.orders for select using (true);
create policy orders_insert on public.orders for insert with check (true);
create policy items_select  on public.items  for select using (true);
create policy items_insert  on public.items  for insert with check (true);
-- Like insert, edit/delete are open at the DB level (link-based, no login).
-- The app limits the buttons to the drinks a device added, plus the organizer.
create policy items_update  on public.items  for update using (true) with check (true);
create policy items_delete  on public.items  for delete using (true);

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
