-- 024 · Moderadores: cerrar y resolver CUALQUIER mercado · portafolio de cada jugador · gráficas con punto de anclaje
--
-- 1) resolve_market: un moderador (como el dueño) puede decidir el resultado final de cualquier mercado que pueda ver.
--    Deshacer una resolución y anular un mercado siguen siendo solo del dueño.
-- 2) staff_update_market: un moderador puede CERRAR las apuestas de cualquier mercado (closes_at ya o en ≤ 2 minutos);
--    editar texto, foto, categoría o fechas sigue siendo solo de quien creó el mercado (o el dueño).
-- 3) get_player_networth: la serie de patrimonio (efectivo + en apuestas) de UN jugador, con punto de anclaje para que
--    cualquier rango (1H, 6H, 1D, Todo) empiece donde corresponde.
-- 4) get_networth_race: ahora también con punto de anclaje por jugador (antes, un rango sin operaciones salía vacío).

-- ---------------------------------------------------------------------
-- Resolver: el dueño y cualquier moderador pueden decidir el resultado de cualquier mercado
-- ---------------------------------------------------------------------
create or replace function public.resolve_market(p_market_id uuid, p_outcome text)
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg            public.game_settings;
  v_market       public.markets;
  v_total        numeric;
  v_winners      int;
  v_notified     int;
  v_volume       numeric := 0;
  v_people       int := 0;
  v_each         numeric := 0;
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Solo administradores o moderadores pueden resolver mercados';
  end if;
  if p_outcome is null or p_outcome not in ('YES', 'NO') then
    raise exception 'El resultado debe ser YES o NO';
  end if;
  select * into cfg from public.game_settings limit 1;

  select * into v_market from public.markets where id = p_market_id for update;
  if not found or not public.can_see_market(v_market.target_users, v_market.created_by) then
    raise exception 'El mercado no existe';
  end if;
  if v_market.closed then raise exception 'El mercado ya está cerrado'; end if;

  with holders as (
    select s.user_id,
           coalesce(sum(s.count) filter (where s.side = p_outcome), 0) as win_shares
    from public.shares s
    where s.market_id = p_market_id and s.count > 0
    group by s.user_id
  ), flow as (
    select t.user_id, sum(case t.type when 'BUY' then t.total_cost else -t.total_cost end) as net_invested
    from public.transactions t
    where t.market_id = p_market_id and t.type in ('BUY', 'SELL')
    group by t.user_id
  ), paid as (
    update public.profiles p set balance = round(p.balance + h.win_shares, 4)
    from holders h where p.id = h.user_id and h.win_shares > 0
    returning h.user_id, h.win_shares
  ), logged as (
    insert into public.transactions (user_id, market_id, type, side, shares_amount, price_per_share, total_cost)
    select user_id, p_market_id, 'RESOLVE', p_outcome, win_shares, 1.00, win_shares from paid
    returning 1
  ), notes as (
    insert into public.notifications (user_id, kind, market_id, payload)
    select h.user_id,
           case when h.win_shares > 0 then 'MARKET_WON' else 'MARKET_LOST' end,
           p_market_id,
           jsonb_build_object('question', v_market.question, 'group_topic', v_market.group_topic, 'outcome', p_outcome,
                              'payout', h.win_shares, 'invested', coalesce(f.net_invested, 0),
                              'profit', h.win_shares - coalesce(f.net_invested, 0))
    from holders h left join flow f on f.user_id = h.user_id
    returning 1
  )
  select coalesce((select sum(win_shares) from paid), 0),
         (select count(*) from paid)::int,
         (select count(*) from notes)::int
  into v_total, v_winners, v_notified;

  -- Premio para quienes NO pudieron participar (mercado sorpresa)
  if coalesce(array_length(v_market.target_users, 1), 0) > 0 and cfg.hidden_reward_pct > 0 and cfg.hidden_reward_cap > 0 then
    select coalesce(sum(t.total_cost), 0) into v_volume
    from public.transactions t where t.market_id = p_market_id and t.type = 'BUY';
    select count(*)::int into v_people
    from public.profiles p
    where p.id = any (v_market.target_users) and p.username is not null and p.disabled_at is null
      and not p.is_admin and p.id is distinct from v_market.created_by;
    if v_volume > 0 and v_people > 0 then
      v_each := least(
        round(case when cfg.hidden_reward_mode = 'each' then v_volume * cfg.hidden_reward_pct
                   else v_volume * cfg.hidden_reward_pct / v_people end, 4),
        cfg.hidden_reward_cap);
      if v_each > 0 then
        with rec as (
          select p.id from public.profiles p
          where p.id = any (v_market.target_users) and p.username is not null and p.disabled_at is null
            and not p.is_admin and p.id is distinct from v_market.created_by
        ), upd as (
          update public.profiles pr set balance = round(pr.balance + v_each, 4) from rec where pr.id = rec.id returning pr.id
        ), ins as (
          insert into public.transactions (user_id, market_id, type, side, shares_amount, price_per_share, total_cost)
          select id, p_market_id, 'REWARD', p_outcome, 0, 0, v_each from upd
          returning 1
        )
        insert into public.notifications (user_id, kind, market_id, payload)
        select id, 'HIDDEN_REWARD', null,
               jsonb_build_object('amount', v_each, 'volume', v_volume, 'market_id', p_market_id,
                                  'question', v_market.question, 'group_topic', v_market.group_topic, 'outcome', p_outcome,
                                  'people', v_people, 'pct', cfg.hidden_reward_pct, 'mode', cfg.hidden_reward_mode) from upd;
      else
        v_people := 0;
      end if;
    else
      v_people := 0;
    end if;
  end if;

  update public.markets set closed = true, outcome = p_outcome, resolved_at = clock_timestamp() where id = p_market_id;
  perform public._snapshot_networth(true);

  perform public.log_admin_action('resolve_market', null, v_total,
    jsonb_build_object('market_id', p_market_id, 'question', v_market.question, 'outcome', p_outcome, 'winners', v_winners,
                       'reward_each', v_each, 'reward_people', v_people, 'volume', v_volume));

  return json_build_object('success', true, 'outcome', p_outcome, 'total_paid', v_total,
                           'winners', v_winners, 'notified', v_notified,
                           'reward_each', v_each, 'reward_people', v_people, 'volume', v_volume);
end $$;

-- ---------------------------------------------------------------------
-- Editar / cerrar apuestas
-- ---------------------------------------------------------------------
create or replace function public.staff_update_market(p_market_id uuid, p_patch jsonb, p_apply_group boolean default true)
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg     public.game_settings;
  m       public.markets;
  v_cat   text;
  v_close timestamptz;
  v_open  timestamptz;
  v_has_open boolean := p_patch ? 'opens_at';
  v_eff_close timestamptz;
  v_eff_open  timestamptz;
  v_n     int := 0;
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Solo administradores o moderadores pueden editar mercados';
  end if;
  select * into cfg from public.game_settings limit 1;
  select * into m from public.markets where id = p_market_id for update;
  if not found or not public.can_see_market(m.target_users, m.created_by) then
    raise exception 'El mercado no existe';
  end if;
  if not public.is_admin() and m.created_by is distinct from auth.uid() then
    -- Un moderador puede CERRAR las apuestas de cualquier mercado (poner el cierre ya, o dentro de 2 minutos como máximo),
    -- pero solo editar (texto, foto, categoría, fechas) los que él creó.
    if m.closed
       or exists (select 1 from jsonb_object_keys(p_patch) k where k <> 'closes_at')
       or not (p_patch ? 'closes_at')
       or nullif(p_patch->>'closes_at', '') is null
       or (p_patch->>'closes_at')::timestamptz > now() + interval '2 minutes' then
      raise exception 'Solo puedes editar los mercados que tú creaste. Sí puedes cerrar las apuestas y resolver cualquier mercado';
    end if;
  end if;

  if p_patch ? 'question' then
    if char_length(btrim(coalesce(p_patch->>'question', ''))) not between 3 and 200 then
      raise exception 'La pregunta debe tener entre 3 y 200 caracteres';
    end if;
    update public.markets set question = btrim(p_patch->>'question') where id = p_market_id;
  end if;
  if p_patch ? 'description' then
    if char_length(coalesce(p_patch->>'description', '')) > 1000 then raise exception 'La descripción es demasiado larga'; end if;
    update public.markets set description = nullif(btrim(p_patch->>'description'), '')
    where id = p_market_id or (p_apply_group and m.group_id is not null and group_id = m.group_id);
  end if;

  if p_patch ? 'category' then
    v_cat := coalesce(p_patch->>'category', 'otros');
    if v_cat not in ('deportes', 'familia', 'comida', 'viaje', 'juegos', 'clima', 'musica', 'otros') then
      raise exception 'Categoría inválida';
    end if;
  end if;
  if p_patch ? 'closes_at' then v_close := nullif(p_patch->>'closes_at', '')::timestamptz; end if;

  if v_has_open then
    v_open := nullif(p_patch->>'opens_at', '')::timestamptz;
    if v_open is not null and v_open <= now() + interval '30 seconds' then v_open := null; end if; -- «abrir ya»
    if v_open is not null and exists (
         select 1 from public.transactions t join public.markets x on x.id = t.market_id
         where t.type in ('BUY', 'SELL') and (x.id = p_market_id or (p_apply_group and m.group_id is not null and x.group_id = m.group_id))) then
      raise exception 'No se puede reprogramar la apertura: el mercado ya tiene operaciones';
    end if;
  end if;
  v_eff_close := case when p_patch ? 'closes_at' then v_close else m.closes_at end;
  v_eff_open  := case when v_has_open then v_open else m.opens_at end;
  if v_eff_open is not null and v_eff_close is not null and v_eff_open >= v_eff_close then
    raise exception 'La apertura debe ser antes del cierre';
  end if;

  if (p_patch ? 'image_url' or p_patch ? 'image_thumb_url')
     and ((nullif(p_patch->>'image_url', '') is not null
           and left(p_patch->>'image_url', char_length(cfg.images_base_url)) <> cfg.images_base_url)
       or (nullif(p_patch->>'image_thumb_url', '') is not null
           and left(p_patch->>'image_thumb_url', char_length(cfg.images_base_url)) <> cfg.images_base_url)) then
    raise exception 'La imagen debe subirse desde la app';
  end if;

  update public.markets x set
    category        = case when p_patch ? 'category' then v_cat else x.category end,
    closes_at       = case when p_patch ? 'closes_at' then v_close else x.closes_at end,
    opens_at        = case when v_has_open then v_open else x.opens_at end,
    image_url       = case when p_patch ? 'image_url' then nullif(p_patch->>'image_url', '') else x.image_url end,
    image_thumb_url = case when p_patch ? 'image_thumb_url' then nullif(p_patch->>'image_thumb_url', '') else x.image_thumb_url end,
    image_color     = case when p_patch ? 'image_color' then
                         case when (p_patch->>'image_color') ~ '^#[0-9a-fA-F]{6}$' then p_patch->>'image_color' else null end
                       else x.image_color end,
    group_topic     = case when p_patch ? 'group_topic' and x.group_topic is not null
                         then coalesce(nullif(btrim(p_patch->>'group_topic'), ''), x.group_topic) else x.group_topic end
  where (x.id = p_market_id or (p_apply_group and m.group_id is not null and x.group_id = m.group_id));
  get diagnostics v_n = row_count;

  perform public.log_admin_action('update_market', null, null,
    jsonb_build_object('market_id', p_market_id, 'question', m.question,
                       'keys', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p_patch) k)));
  return json_build_object('success', true, 'updated', v_n);
end $$;

-- ---------------------------------------------------------------------
-- Patrimonio de un jugador en el tiempo (su «portafolio»)
-- ---------------------------------------------------------------------
create or replace function public.get_player_networth(p_user_id uuid, p_since timestamptz default null, p_max_points integer default 80)
returns table(taken_at timestamptz, cash numeric, positions numeric, net_worth numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_max int := least(greatest(coalesce(p_max_points, 80), 10), 300);
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.username is not null and p.disabled_at is null) then
    return;
  end if;
  return query
  with src as (
    select s.taken_at as ts, s.cash as c, s.positions as pz, s.net_worth as nw, s.id as sid
    from public.networth_snapshots s
    where s.user_id = p_user_id and (p_since is null or s.taken_at >= p_since)
    union all
    (select p_since, s.cash, s.positions, s.net_worth, s.id
     from public.networth_snapshots s
     where p_since is not null and s.user_id = p_user_id and s.taken_at < p_since
     order by s.taken_at desc, s.id desc limit 1)
  ), hh as (
    select x.ts, x.c, x.pz, x.nw, x.sid,
           row_number() over (order by x.ts, x.sid) as rn,
           count(*) over () as cnt
    from src x
  )
  select hh.ts, hh.c, hh.pz, hh.nw
  from hh
  where hh.cnt <= v_max or hh.rn = 1 or hh.rn = hh.cnt or hh.rn % ceil(hh.cnt::numeric / v_max)::int = 0
  order by hh.ts, hh.sid;
end $$;

revoke all on function public.get_player_networth(uuid, timestamptz, integer) from public, anon;
grant execute on function public.get_player_networth(uuid, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------
-- Carrera de patrimonio con punto de anclaje por jugador
-- ---------------------------------------------------------------------
create or replace function public.get_networth_race(p_since timestamptz default null, p_max_points integer default 60)
returns table(user_id uuid, username text, taken_at timestamptz, net_worth numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_max int := least(greatest(coalesce(p_max_points, 60), 10), 200);
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  return query
  with src as (
    select s.user_id as uid, s.taken_at as ts, s.net_worth as nw, s.id as sid
    from public.networth_snapshots s
    where p_since is null or s.taken_at >= p_since
    union all
    select a.user_id, p_since, a.net_worth, a.id
    from (select distinct on (s.user_id) s.user_id, s.net_worth, s.id
          from public.networth_snapshots s
          where p_since is not null and s.taken_at < p_since
          order by s.user_id, s.taken_at desc, s.id desc) a
  ), hh as (
    select x.uid, x.ts, x.nw, x.sid,
           row_number() over (partition by x.uid order by x.ts, x.sid) as rn,
           count(*) over (partition by x.uid) as cnt
    from src x
  )
  select hh.uid, p.username, hh.ts, hh.nw
  from hh
  join public.profiles p on p.id = hh.uid
  where p.username is not null and p.disabled_at is null
    and (hh.cnt <= v_max or hh.rn = 1 or hh.rn = hh.cnt
         or hh.rn % ceil(hh.cnt::numeric / v_max)::int = 0)
  order by hh.ts, p.username;
end $$;
