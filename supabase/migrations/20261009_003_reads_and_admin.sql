-- =====================================================================
-- 003 · LECTURAS (ranking, portafolio, historial, movimientos diarios)
--       + ADMIN (listar jugadores, archivar y reiniciar la partida)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Movimientos diarios (fuente unica de verdad: hora de Venezuela)
-- ---------------------------------------------------------------------
create or replace function public.get_daily_moves()
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_limit int;
  v_used  int;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select daily_limit into v_limit from public.game_settings limit 1;
  v_used := public.daily_moves_used(v_uid);
  return json_build_object(
    'used', v_used,
    'remaining', greatest(v_limit - v_used, 0),
    'limit', v_limit,
    'resets_at', public.game_day_start() + interval '1 day'
  );
end $$;

-- ---------------------------------------------------------------------
-- Ranking: solo nombre de usuario y numeros (NUNCA emails)
-- ---------------------------------------------------------------------
create or replace function public.get_leaderboard()
returns table (user_id uuid, username text, cash numeric, positions_value numeric, net_worth numeric, rank bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  return query
  select x.id, x.username, x.balance, x.pos, x.balance + x.pos,
         row_number() over (order by x.balance + x.pos desc, x.username)
  from (
    select p.id, p.username, p.balance, coalesce(v.pos, 0) as pos
    from public.profiles p
    left join lateral (
      select sum(s.count * case s.side
                             when 'YES' then m.no_pool / (m.yes_pool + m.no_pool)
                             else m.yes_pool / (m.yes_pool + m.no_pool)
                           end) as pos
      from public.shares s
      join public.markets m on m.id = s.market_id
      where s.user_id = p.id and not m.closed and s.count > 0
    ) v on true
    where p.username is not null
  ) x
  order by 6;
end $$;

-- ---------------------------------------------------------------------
-- Portafolio propio con costo promedio calculado en el servidor
-- ---------------------------------------------------------------------
create or replace function public._position_avg_cost(p_user uuid, p_market uuid, p_side text)
returns numeric
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  r        record;
  v_shares numeric := 0;
  v_cost   numeric := 0;
begin
  for r in
    select type, shares_amount, total_cost
    from public.transactions
    where user_id = p_user and market_id = p_market and side = p_side and type in ('BUY', 'SELL')
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

create or replace function public.get_my_portfolio()
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  return json_build_object(
    'balance', (select balance from public.profiles where id = v_uid),
    'positions', coalesce((
      select json_agg(x order by x.question)
      from (
        select s.market_id, m.question, m.group_topic, s.side, s.count as shares,
               m.outcome, m.closed, m.yes_pool, m.no_pool,
               public._position_avg_cost(s.user_id, s.market_id, s.side) as avg_cost
        from public.shares s
        join public.markets m on m.id = s.market_id
        where s.user_id = v_uid and s.count > 0
      ) x), '[]'::json)
  );
end $$;

-- ---------------------------------------------------------------------
-- Historial de precios muestreado (siempre incluye el primero y el ultimo punto)
-- ---------------------------------------------------------------------
create or replace function public.get_market_history(p_market_id uuid, p_limit int default 150)
returns table (created_at timestamptz, yes_price numeric, no_price numeric)
language sql
stable
set search_path = public, pg_temp
as $$
  with hh as (
    select mh.created_at, mh.yes_price, mh.no_price,
           row_number() over (order by mh.created_at, mh.id) as rn,
           count(*) over () as cnt
    from public.market_prices_history mh
    where mh.market_id = p_market_id
  )
  select hh.created_at, hh.yes_price, hh.no_price
  from hh
  where hh.cnt <= greatest(p_limit, 10)
     or hh.rn = 1 or hh.rn = hh.cnt
     or hh.rn % ceil(hh.cnt::numeric / greatest(p_limit, 10))::int = 0
  order by hh.created_at
$$;

-- ---------------------------------------------------------------------
-- ADMIN
-- ---------------------------------------------------------------------
create or replace function public.admin_list_players()
returns table (id uuid, username text, balance numeric, is_admin boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Solo administradores';
  end if;
  return query
  select p.id, p.username, p.balance, p.is_admin
  from public.profiles p
  order by lower(p.username) nulls last;
end $$;

-- Reinicio interno (sin chequeo de usuario: solo lo invocan funciones definer
-- o el propietario desde el SQL Editor). Conserva cuentas y nombres de usuario.
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
  delete from public.market_prices_history;
  delete from public.transaction_logs;
  delete from public.transactions;
  delete from public.shares;
  delete from public.markets;
  update public.profiles set balance = v_balance;

  return json_build_object(
    'markets_deleted', v_markets,
    'players_reset', (select count(*) from public.profiles),
    'balance', v_balance
  );
end $$;
revoke all on function archive.reset_game() from public, anon, authenticated;

create or replace function public.admin_archive_and_reset(p_title text, p_slug text)
returns json
language plpgsql
security definer
set search_path = public, archive, pg_temp
as $$
declare
  v_season  uuid;
  v_players int;
  v_markets int;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Solo administradores pueden reiniciar la partida';
  end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception 'Falta el título del recuerdo'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,60}$' then raise exception 'Identificador inválido'; end if;

  -- Bloquea todos los mercados: ninguna operacion puede colarse mientras se archiva y reinicia.
  perform 1 from public.markets for update;

  v_season := archive.snapshot_current_game(p_slug, btrim(p_title), 'Archivada desde el panel de administración');
  select count(*) into v_players from archive.profiles where season_id = v_season;
  select count(*) into v_markets from archive.markets where season_id = v_season;
  perform archive.reset_game();

  perform public.log_admin_action('archive_and_reset', null, null,
    jsonb_build_object('slug', p_slug, 'title', p_title, 'players', v_players, 'markets', v_markets));

  return json_build_object('success', true, 'season_id', v_season, 'players', v_players, 'markets', v_markets);
end $$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke all on function public._position_avg_cost(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.get_daily_moves() from public, anon;
revoke all on function public.get_leaderboard() from public, anon;
revoke all on function public.get_my_portfolio() from public, anon;
revoke all on function public.get_market_history(uuid, int) from public, anon;
revoke all on function public.admin_list_players() from public, anon;
revoke all on function public.admin_archive_and_reset(text, text) from public, anon;

grant execute on function public.get_daily_moves() to authenticated;
grant execute on function public.get_leaderboard() to authenticated;
grant execute on function public.get_my_portfolio() to authenticated;
grant execute on function public.get_market_history(uuid, int) to authenticated;
grant execute on function public.admin_list_players() to authenticated;
grant execute on function public.admin_archive_and_reset(text, text) to authenticated;
