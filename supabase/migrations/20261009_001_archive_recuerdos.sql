-- =====================================================================
-- 001 · ARCHIVO DE TEMPORADAS ("Recuerdos") + SNAPSHOT DEL ULTIMO JUEGO
-- =====================================================================
-- Crea el schema privado `archive` (no expuesto por la API) donde se guarda
-- una copia fiel de cada partida terminada. Se lee solo mediante RPC
-- SECURITY DEFINER para usuarios autenticados.
-- Esta migracion NO modifica los datos vivos del juego.
-- =====================================================================

create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;

create table if not exists archive.seasons (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null,
  played_from timestamptz,
  played_to   timestamptz,
  archived_at timestamptz not null default now(),
  note        text
);

create table if not exists archive.profiles (
  season_id             uuid not null references archive.seasons(id) on delete cascade,
  user_id               uuid not null,
  username              text,
  email                 text,
  is_admin              boolean,
  final_cash            numeric not null,
  final_positions_value numeric not null default 0,
  final_net_worth       numeric not null,
  final_rank            int not null,
  primary key (season_id, user_id)
);

-- Copias exactas de las tablas del juego (+ season_id). Sin FKs hacia public.
create table if not exists archive.markets (
  season_id uuid not null references archive.seasons(id) on delete cascade,
  like public.markets,
  primary key (season_id, id)
);
create table if not exists archive.shares (
  season_id uuid not null references archive.seasons(id) on delete cascade,
  like public.shares,
  primary key (season_id, id)
);
create table if not exists archive.transactions (
  season_id uuid not null references archive.seasons(id) on delete cascade,
  like public.transactions,
  primary key (season_id, id)
);
create table if not exists archive.transaction_logs (
  season_id uuid not null references archive.seasons(id) on delete cascade,
  like public.transaction_logs,
  primary key (season_id, id)
);
create table if not exists archive.market_prices_history (
  season_id uuid not null references archive.seasons(id) on delete cascade,
  like public.market_prices_history,
  primary key (season_id, id)
);

create index if not exists archive_shares_user_idx on archive.shares (season_id, user_id);
create index if not exists archive_tx_user_idx on archive.transactions (season_id, user_id, created_at);
create index if not exists archive_tx_market_idx on archive.transactions (season_id, market_id);

-- ---------------------------------------------------------------------
-- Las tablas *_backup que dejo el chat original estaban en `public` SIN RLS
-- (emails y saldos legibles por cualquiera). Se mueven al archivo privado.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['markets_backup','profiles_backup','shares_backup',
                           'transactions_backup','transaction_logs_backup','market_prices_history_backup']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I set schema archive', t);
      execute format('alter table archive.%I rename to %I', t, 'legacy_' || t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Snapshot de la partida en curso -> archive.* (no borra nada)
-- ---------------------------------------------------------------------
create or replace function archive.snapshot_current_game(p_slug text, p_title text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public, archive, pg_temp
as $$
declare
  v_season uuid;
begin
  if exists (select 1 from archive.seasons where slug = p_slug) then
    raise exception 'Ya existe una temporada con slug %', p_slug;
  end if;

  insert into archive.seasons (slug, title, played_from, played_to, note)
  values (p_slug, p_title,
          (select min(created_at) from public.transactions),
          (select max(created_at) from public.transactions),
          p_note)
  returning id into v_season;

  insert into archive.markets               select v_season, m.* from public.markets m;
  insert into archive.shares                select v_season, s.* from public.shares s;
  insert into archive.transactions          select v_season, t.* from public.transactions t;
  insert into archive.transaction_logs      select v_season, l.* from public.transaction_logs l;
  insert into archive.market_prices_history select v_season, h.* from public.market_prices_history h;

  insert into archive.profiles
    (season_id, user_id, username, email, is_admin, final_cash, final_positions_value, final_net_worth, final_rank)
  select v_season, x.id, x.username, x.email, x.is_admin, x.balance, x.pos, x.balance + x.pos,
         rank() over (order by x.balance + x.pos desc)
  from (
    select p.id, p.username, p.email, p.is_admin, p.balance,
           coalesce((
             select sum(s.count * case s.side
                                    when 'YES' then m.no_pool / (m.yes_pool + m.no_pool)
                                    else m.yes_pool / (m.yes_pool + m.no_pool)
                                  end)
             from public.shares s
             join public.markets m on m.id = s.market_id
             where s.user_id = p.id and not m.closed and s.count > 0
           ), 0) as pos
    from public.profiles p
  ) x;

  return v_season;
end $$;
revoke all on function archive.snapshot_current_game(text, text, text) from public, anon, authenticated;

-- Costo promedio ponderado de una posicion archivada (misma regla que el portafolio)
create or replace function archive.position_avg_cost(p_season uuid, p_user uuid, p_market uuid, p_side text)
returns numeric
language plpgsql
stable
set search_path = archive, pg_temp
as $$
declare
  r record;
  v_shares numeric := 0;
  v_cost   numeric := 0;
begin
  for r in
    select type, shares_amount, total_cost
    from archive.transactions
    where season_id = p_season and user_id = p_user and market_id = p_market
      and side = p_side and type in ('BUY', 'SELL')
    order by created_at, id
  loop
    if r.type = 'BUY' then
      v_cost := v_cost + r.total_cost;
      v_shares := v_shares + r.shares_amount;
    elsif v_shares > 0 then
      v_cost := v_cost - v_cost * least(r.shares_amount / v_shares, 1);
      v_shares := greatest(v_shares - r.shares_amount, 0);
    end if;
  end loop;
  return case when v_shares > 0 then v_cost / v_shares else 0 end;
end $$;
revoke all on function archive.position_avg_cost(uuid, uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- RPC de lectura para la vista "Recuerdos" (solo usuarios autenticados)
-- ---------------------------------------------------------------------
create or replace function public.list_seasons()
returns table (id uuid, slug text, title text, played_from timestamptz, played_to timestamptz,
               players bigint, markets bigint, champion text, champion_net_worth numeric)
language plpgsql
stable
security definer
set search_path = public, archive, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  return query
  select s.id, s.slug, s.title, s.played_from, s.played_to,
         (select count(*) from archive.profiles p where p.season_id = s.id),
         (select count(*) from archive.markets m where m.season_id = s.id),
         (select p.username from archive.profiles p where p.season_id = s.id order by p.final_rank, p.username limit 1),
         (select p.final_net_worth from archive.profiles p where p.season_id = s.id order by p.final_rank, p.username limit 1)
  from archive.seasons s
  order by s.played_to desc nulls last;
end $$;
revoke all on function public.list_seasons() from public, anon;
grant execute on function public.list_seasons() to authenticated;

create or replace function public.get_season(p_slug text)
returns json
language plpgsql
stable
security definer
set search_path = public, archive, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_season archive.seasons;
  v_admin  boolean;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select * into v_season from archive.seasons where slug = p_slug;
  if not found then raise exception 'Temporada no encontrada'; end if;
  v_admin := coalesce((select is_admin from public.profiles where id = v_uid), false);

  return json_build_object(
    'season', to_json(v_season),
    'ranking', coalesce((
      select json_agg(json_build_object(
               'user_id', p.user_id, 'username', p.username, 'cash', p.final_cash,
               'positions_value', p.final_positions_value, 'net_worth', p.final_net_worth,
               'rank', p.final_rank) order by p.final_rank, p.username)
      from archive.profiles p where p.season_id = v_season.id), '[]'::json),
    'markets', coalesce((
      select json_agg(json_build_object(
               'id', m.id, 'question', m.question, 'group_topic', m.group_topic,
               'outcome', m.outcome, 'closed', m.closed, 'resolved_at', m.resolved_at,
               'yes_price', m.no_pool / (m.yes_pool + m.no_pool),
               'no_price',  m.yes_pool / (m.yes_pool + m.no_pool),
               'trades', (select count(*) from archive.transactions t
                          where t.season_id = m.season_id and t.market_id = m.id and t.type in ('BUY', 'SELL')))
             order by m.group_topic nulls first, m.created_at)
      from archive.markets m
      where m.season_id = v_season.id
        and (v_admin or m.target_users is null or not (v_uid::text = any (m.target_users::text[])))
    ), '[]'::json)
  );
end $$;
revoke all on function public.get_season(text) from public, anon;
grant execute on function public.get_season(text) to authenticated;

create or replace function public.get_season_player(p_slug text, p_user_id uuid)
returns json
language plpgsql
stable
security definer
set search_path = public, archive, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_season uuid;
  v_admin  boolean;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select id into v_season from archive.seasons where slug = p_slug;
  if v_season is null then raise exception 'Temporada no encontrada'; end if;
  v_admin := coalesce((select is_admin from public.profiles where id = v_uid), false);

  return json_build_object(
    'profile', (
      select json_build_object(
               'user_id', p.user_id, 'username', p.username, 'cash', p.final_cash,
               'positions_value', p.final_positions_value, 'net_worth', p.final_net_worth,
               'rank', p.final_rank)
      from archive.profiles p where p.season_id = v_season and p.user_id = p_user_id),
    'positions', coalesce((
      select json_agg(x order by x.question)
      from (
        select m.id as market_id, m.question, m.group_topic, s.side, s.count as shares,
               m.outcome, m.closed,
               m.no_pool / (m.yes_pool + m.no_pool) as yes_price,
               m.yes_pool / (m.yes_pool + m.no_pool) as no_price,
               archive.position_avg_cost(v_season, s.user_id, s.market_id, s.side) as avg_cost
        from archive.shares s
        join archive.markets m on m.season_id = s.season_id and m.id = s.market_id
        where s.season_id = v_season and s.user_id = p_user_id and s.count > 0
          and (v_admin or m.target_users is null or not (v_uid::text = any (m.target_users::text[])))
      ) x), '[]'::json),
    'operations', coalesce((
      select json_agg(y order by y.at desc)
      from (
        select t.created_at as at, t.market_id, m.question, t.type, t.side,
               t.shares_amount as shares, t.price_per_share as price, t.total_cost as total
        from archive.transactions t
        join archive.markets m on m.season_id = t.season_id and m.id = t.market_id
        where t.season_id = v_season and t.user_id = p_user_id
          and (v_admin or m.target_users is null or not (v_uid::text = any (m.target_users::text[])))
        order by t.created_at desc
        limit 1000
      ) y), '[]'::json)
  );
end $$;
revoke all on function public.get_season_player(text, uuid) from public, anon;
grant execute on function public.get_season_player(text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- SNAPSHOT del ultimo juego (13-19 feb 2026)
-- ---------------------------------------------------------------------
select archive.snapshot_current_game(
  'juego-2026-02',
  'FamilyMarket · Febrero 2026',
  'Primera partida. Archivada el 9-oct-2026 antes de reiniciar desde cero.'
);
