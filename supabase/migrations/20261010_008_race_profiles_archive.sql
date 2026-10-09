-- =====================================================================
-- 008 · CARRERA DE PATRIMONIO, PERFILES CON ESTADISTICAS Y ARCHIVO
--       (arregla "Nueva partida": archive.markets ya no calza con markets)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Archivo: columnas nuevas de markets + snapshots de patrimonio
-- ---------------------------------------------------------------------
alter table archive.markets
  add column if not exists category        text,
  add column if not exists closes_at       timestamptz,
  add column if not exists group_id        uuid,
  add column if not exists image_thumb_url text,
  add column if not exists image_color     text,
  add column if not exists created_by      uuid,
  add column if not exists static_rev      int;

create table if not exists archive.networth_snapshots (
  season_id uuid not null references archive.seasons(id) on delete cascade,
  id        bigint not null,
  user_id   uuid not null,
  taken_at  timestamptz not null,
  cash      numeric(16,4) not null,
  positions numeric(16,4) not null,
  net_worth numeric(16,4) not null,
  primary key (season_id, id)
);
create index if not exists archive_networth_user_idx on archive.networth_snapshots (season_id, user_id, taken_at);
alter table archive.networth_snapshots enable row level security;
revoke all on archive.networth_snapshots from public, anon, authenticated;

-- Listas de columnas EXPLICITAS: agregar una columna a public.* nunca vuelve a
-- romper el archivado.
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

  insert into archive.markets
    (season_id, id, question, description, image_url, yes_pool, no_pool, outcome, closed, created_at, resolved_at,
     group_topic, target_users, category, closes_at, group_id, image_thumb_url, image_color, created_by, static_rev)
  select v_season, m.id, m.question, m.description, m.image_url, m.yes_pool, m.no_pool, m.outcome, m.closed,
         m.created_at, m.resolved_at, m.group_topic, m.target_users, m.category, m.closes_at, m.group_id,
         m.image_thumb_url, m.image_color, m.created_by, m.static_rev
  from public.markets m;

  insert into archive.shares (season_id, id, user_id, market_id, side, count, created_at, updated_at)
  select v_season, s.id, s.user_id, s.market_id, s.side, s.count, s.created_at, s.updated_at from public.shares s;

  insert into archive.transactions
    (season_id, id, user_id, market_id, type, side, shares_amount, price_per_share, total_cost, created_at)
  select v_season, t.id, t.user_id, t.market_id, t.type, t.side, t.shares_amount, t.price_per_share, t.total_cost,
         t.created_at
  from public.transactions t;

  insert into archive.transaction_logs
    (season_id, id, user_id, market_id, action, side, amount, price, total_cost, created_at)
  select v_season, l.id, l.user_id, l.market_id, l.action, l.side, l.amount, l.price, l.total_cost, l.created_at
  from public.transaction_logs l;

  insert into archive.market_prices_history
    (season_id, id, market_id, yes_price, no_price, yes_pool, no_pool, created_at)
  select v_season, h.id, h.market_id, h.yes_price, h.no_price, h.yes_pool, h.no_pool, h.created_at
  from public.market_prices_history h;

  insert into archive.networth_snapshots (season_id, id, user_id, taken_at, cash, positions, net_worth)
  select v_season, n.id, n.user_id, n.taken_at, n.cash, n.positions, n.net_worth from public.networth_snapshots n;

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

-- Reinicio: ademas limpia notificaciones, sugerencias ya revisadas y snapshots,
-- y deja un punto base ($inicial para todos) para la grafica de la carrera.
create or replace function archive.reset_game()
returns json
language plpgsql
security definer
set search_path = public, archive, pg_temp
as $$
declare
  v_markets int;
  v_balance numeric;
begin
  select initial_balance into v_balance from public.game_settings limit 1;
  select count(*) into v_markets from public.markets;

  delete from public.trade_requests;
  delete from public.notifications;
  delete from public.market_suggestions where status <> 'pending';
  update public.market_suggestions set market_id = null;
  delete from public.networth_snapshots;
  delete from public.market_prices_history;
  delete from public.transaction_logs;
  delete from public.transactions;
  delete from public.shares;
  delete from public.markets;
  update public.profiles set balance = v_balance;
  perform public._snapshot_networth(true);

  return json_build_object(
    'markets_deleted', v_markets,
    'players_reset', (select count(*) from public.profiles),
    'balance', v_balance
  );
end $$;
revoke all on function archive.reset_game() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Carrera de patrimonio (serie por jugador, muestreada)
-- ---------------------------------------------------------------------
create or replace function public.get_networth_race(p_since timestamptz default null, p_max_points int default 60)
returns table (user_id uuid, username text, taken_at timestamptz, net_worth numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_max int := least(greatest(coalesce(p_max_points, 60), 10), 200);
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  return query
  with src as (
    select s.user_id, s.taken_at, s.net_worth, s.id
    from public.networth_snapshots s
    where p_since is null or s.taken_at >= p_since
  ), hh as (
    select x.user_id, x.taken_at, x.net_worth,
           row_number() over (partition by x.user_id order by x.taken_at, x.id) as rn,
           count(*) over (partition by x.user_id) as cnt
    from src x
  )
  select hh.user_id, p.username, hh.taken_at, hh.net_worth
  from hh
  join public.profiles p on p.id = hh.user_id
  where p.username is not null
    and (hh.cnt <= v_max or hh.rn = 1 or hh.rn = hh.cnt
         or hh.rn % ceil(hh.cnt::numeric / v_max)::int = 0)
  order by hh.taken_at, p.username;
end $$;

-- ---------------------------------------------------------------------
-- 3. Perfil de jugador con estadisticas (solo mercados que el que mira puede ver)
-- ---------------------------------------------------------------------
create or replace function public.get_player_profile(p_user_id uuid)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_name     text;
  v_since    timestamptz;
  v_cash     numeric;
  v_pos      numeric;
  v_net      numeric;
  v_rank     bigint;
  v_players  int;
  v_trades   int;
  v_traded   int;
  v_open     int;
  v_fav      text;
  v_wins     int := 0;
  v_losses   int := 0;
  v_best     numeric;
  v_best_q   text;
  v_worst    numeric;
  v_worst_q  text;
  v_kind     text;
  v_run      int := 0;
  v_best_run int := 0;
  v_total_pl numeric := 0;
  r          record;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;

  select p.username, p.created_at into v_name, v_since
  from public.profiles p where p.id = p_user_id and p.username is not null;
  if not found then raise exception 'Jugador no encontrado'; end if;

  select l.cash, l.positions_value, l.net_worth, l.rank into v_cash, v_pos, v_net, v_rank
  from public.get_leaderboard() l where l.user_id = p_user_id;
  select count(*)::int into v_players from public.profiles where username is not null;

  select count(*)::int, count(distinct t.market_id)::int into v_trades, v_traded
  from public.transactions t
  join public.markets m on m.id = t.market_id
  where t.user_id = p_user_id and t.type in ('BUY', 'SELL')
    and public.can_see_market(m.target_users, m.created_by);

  select count(distinct s.market_id)::int into v_open
  from public.shares s
  join public.markets m on m.id = s.market_id
  where s.user_id = p_user_id and s.count > 0 and not m.closed
    and public.can_see_market(m.target_users, m.created_by);

  select m.category into v_fav
  from public.transactions t
  join public.markets m on m.id = t.market_id
  where t.user_id = p_user_id and t.type in ('BUY', 'SELL')
    and public.can_see_market(m.target_users, m.created_by)
  group by m.category
  order by count(*) desc, m.category
  limit 1;

  -- Resultado por mercado resuelto: cobro - (compras - ventas)
  for r in
    select m.question, m.group_topic, m.resolved_at,
           sum(case t.type when 'BUY' then -t.total_cost when 'SELL' then t.total_cost
                           when 'RESOLVE' then t.total_cost end) as profit
    from public.markets m
    join public.transactions t on t.market_id = m.id and t.user_id = p_user_id
    where m.closed and m.outcome in ('YES', 'NO')
      and public.can_see_market(m.target_users, m.created_by)
    group by m.id, m.question, m.group_topic, m.resolved_at
    order by m.resolved_at, m.id
  loop
    continue when r.profit is null or round(r.profit, 4) = 0;
    v_total_pl := v_total_pl + r.profit;
    if r.profit > 0 then
      v_wins := v_wins + 1;
      if v_kind = 'W' then v_run := v_run + 1; else v_kind := 'W'; v_run := 1; end if;
      v_best_run := greatest(v_best_run, v_run);
      if v_best is null or r.profit > v_best then
        v_best := r.profit; v_best_q := coalesce(r.group_topic, r.question);
      end if;
    else
      v_losses := v_losses + 1;
      if v_kind = 'L' then v_run := v_run + 1; else v_kind := 'L'; v_run := 1; end if;
      if v_worst is null or r.profit < v_worst then
        v_worst := r.profit; v_worst_q := coalesce(r.group_topic, r.question);
      end if;
    end if;
  end loop;

  return json_build_object(
    'user_id', p_user_id,
    'username', v_name,
    'member_since', v_since,
    'rank', v_rank,
    'players', v_players,
    'net_worth', v_net,
    'cash', v_cash,
    'positions_value', v_pos,
    'trades', v_trades,
    'markets_traded', v_traded,
    'open_markets', v_open,
    'favorite_category', v_fav,
    'wins', v_wins,
    'losses', v_losses,
    'win_rate', case when v_wins + v_losses > 0 then round(v_wins::numeric / (v_wins + v_losses), 4) else null end,
    'realized_pl', round(v_total_pl, 4),
    'current_streak', v_run,
    'current_streak_kind', v_kind,
    'best_win_streak', v_best_run,
    'best_win', json_build_object('amount', v_best, 'question', v_best_q),
    'worst_loss', json_build_object('amount', v_worst, 'question', v_worst_q)
  );
end $$;

revoke all on function public.get_networth_race(timestamptz, int) from public, anon;
revoke all on function public.get_player_profile(uuid) from public, anon;
grant execute on function public.get_networth_race(timestamptz, int) to authenticated;
grant execute on function public.get_player_profile(uuid) to authenticated;
