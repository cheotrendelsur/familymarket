-- =====================================================================
-- 007 · MOTOR (fecha de cierre, visibilidad) + AVISOS + SUGERENCIAS + FEED + PRECIOS LIGEROS
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Historial de patrimonio (para la gráfica "carrera de patrimonio")
-- ---------------------------------------------------------------------
create table if not exists public.networth_snapshots (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  taken_at   timestamptz not null default now(),
  cash       numeric(16,4) not null,
  positions  numeric(16,4) not null,
  net_worth  numeric(16,4) not null
);
create index if not exists networth_snapshots_user_idx on public.networth_snapshots (user_id, taken_at);
create index if not exists networth_snapshots_time_idx on public.networth_snapshots (taken_at desc);
alter table public.networth_snapshots enable row level security;
revoke all on public.networth_snapshots from anon, authenticated;

-- Foto del patrimonio de todos los jugadores (como mucho cada 5 min, o forzada tras resolver/reiniciar)
create or replace function public._snapshot_networth(p_force boolean default false)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_last timestamptz;
begin
  if not pg_try_advisory_xact_lock(7440123) then return; end if;
  select max(taken_at) into v_last from public.networth_snapshots;
  if p_force or v_last is null or v_last < now() - interval '5 minutes' then
    insert into public.networth_snapshots (user_id, cash, positions, net_worth)
    select p.id, p.balance, coalesce(v.pos, 0), p.balance + coalesce(v.pos, 0)
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
    where p.username is not null;
  end if;
end $$;
revoke all on function public._snapshot_networth(boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Avisos personales (resultados, sugerencias, correcciones)
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('MARKET_WON', 'MARKET_LOST', 'MARKET_REOPENED', 'MARKET_CANCELLED',
                                           'SUGGESTION_APPROVED', 'SUGGESTION_REJECTED')),
  market_id  uuid references public.markets(id) on delete set null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
create index if not exists notifications_unseen_idx on public.notifications (user_id, created_at) where seen_at is null;
create index if not exists notifications_market_idx on public.notifications (market_id) where market_id is not null;
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;

create or replace function public.mark_notifications_seen(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  update public.notifications set seen_at = now()
  where user_id = auth.uid() and seen_at is null and id = any (p_ids);
end $$;

-- Estado ligero de la sesion (se sondea cada ~15 s): hora del servidor, movimientos, avisos, pendientes
create or replace function public.get_session_state()
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
  v_notes json;
  v_pend  int := null;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select daily_limit into v_limit from public.game_settings limit 1;
  v_used := public.daily_moves_used(v_uid);
  select coalesce(json_agg(n order by n.created_at), '[]'::json) into v_notes
  from (select id, kind, market_id, payload, created_at from public.notifications
        where user_id = v_uid and seen_at is null order by created_at limit 20) n;
  if public.is_staff() then
    select count(*)::int into v_pend from public.market_suggestions where status = 'pending';
  end if;
  return json_build_object(
    'server_now', now(),
    'daily', json_build_object('used', v_used, 'remaining', greatest(v_limit - v_used, 0), 'limit', v_limit,
                               'resets_at', public.game_day_start() + interval '1 day'),
    'notifications', v_notes,
    'pending_suggestions', v_pend
  );
end $$;

-- ---------------------------------------------------------------------
-- 3. Sugerencias de mercados (jugadores proponen, dueño/moderadores aprueban)
-- ---------------------------------------------------------------------
create table if not exists public.market_suggestions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  question      text not null,
  description   text,
  category      text not null default 'otros',
  options       text[],
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by   uuid references public.profiles(id) on delete set null,
  reviewed_at   timestamptz,
  reject_reason text,
  market_id     uuid references public.markets(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists market_suggestions_status_idx on public.market_suggestions (status, created_at);
create index if not exists market_suggestions_user_idx on public.market_suggestions (user_id, created_at desc);
alter table public.market_suggestions enable row level security;
revoke all on public.market_suggestions from anon, authenticated;

create or replace function public.suggest_market(
  p_question    text,
  p_description text   default null,
  p_category    text   default 'otros',
  p_options     text[] default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_q    text := btrim(p_question);
  v_desc text := nullif(btrim(p_description), '');
  v_cat  text := coalesce(nullif(btrim(p_category), ''), 'otros');
  v_opts text[];
  v_id   uuid;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and username is not null) then
    raise exception 'Primero elige tu nombre de usuario';
  end if;
  if v_q is null or char_length(v_q) < 8 or char_length(v_q) > 200 then
    raise exception 'La pregunta debe tener entre 8 y 200 caracteres';
  end if;
  if v_desc is not null and char_length(v_desc) > 400 then raise exception 'La descripción es demasiado larga (máx. 400)'; end if;
  if v_cat not in ('deportes', 'familia', 'comida', 'viaje', 'juegos', 'clima', 'musica', 'otros') then
    raise exception 'Categoría inválida';
  end if;
  if p_options is not null then
    select coalesce(array_agg(btrim(o)), '{}') into v_opts from unnest(p_options) o where nullif(btrim(o), '') is not null;
    if coalesce(array_length(v_opts, 1), 0) = 0 then v_opts := null;
    elsif array_length(v_opts, 1) < 2 or array_length(v_opts, 1) > 10 then
      raise exception 'Si das opciones, deben ser entre 2 y 10';
    elsif exists (select 1 from unnest(v_opts) o where char_length(o) > 80) then
      raise exception 'Cada opción puede tener máximo 80 caracteres';
    end if;
  end if;

  if (select count(*) from public.market_suggestions where user_id = v_uid and status = 'pending') >= 3 then
    raise exception 'Ya tienes 3 sugerencias pendientes. Espera a que las revisen.';
  end if;
  if (select count(*) from public.market_suggestions where user_id = v_uid and created_at > now() - interval '24 hours') >= 12 then
    raise exception 'Llegaste al máximo de sugerencias por hoy';
  end if;

  insert into public.market_suggestions (user_id, question, description, category, options)
  values (v_uid, v_q, v_desc, v_cat, v_opts) returning id into v_id;
  return json_build_object('success', true, 'id', v_id);
end $$;

create or replace function public.get_my_suggestions()
returns table (id uuid, question text, description text, category text, options text[], status text,
               reject_reason text, created_at timestamptz, reviewed_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  return query
  select s.id, s.question, s.description, s.category, s.options, s.status, s.reject_reason, s.created_at, s.reviewed_at
  from public.market_suggestions s where s.user_id = auth.uid() order by s.created_at desc limit 30;
end $$;

create or replace function public.staff_list_suggestions(p_status text default 'pending')
returns table (id uuid, user_id uuid, username text, question text, description text, category text, options text[],
               status text, reject_reason text, created_at timestamptz, reviewed_by_username text, market_id uuid)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Solo administradores o moderadores'; end if;
  return query
  select s.id, s.user_id, p.username, s.question, s.description, s.category, s.options, s.status, s.reject_reason,
         s.created_at, rp.username, s.market_id
  from public.market_suggestions s
  join public.profiles p on p.id = s.user_id
  left join public.profiles rp on rp.id = s.reviewed_by
  where p_status is null or s.status = p_status
  order by s.created_at desc
  limit 100;
end $$;

create or replace function public.staff_review_suggestion(
  p_id               uuid,
  p_action           text,
  p_reason           text        default null,
  p_question         text        default null,
  p_description      text        default null,
  p_category         text        default null,
  p_closes_at        timestamptz default null,
  p_image_url        text        default null,
  p_image_thumb_url  text        default null,
  p_image_color      text        default null,
  p_target_users     uuid[]      default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s        public.market_suggestions;
  v_q      text;
  v_desc   text;
  v_cat    text;
  v_ids    uuid[] := '{}';
  v_group  uuid;
  v_opt    text;
  v_first  uuid;
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Solo administradores o moderadores'; end if;
  if p_action not in ('approve', 'reject') then raise exception 'Acción inválida'; end if;
  select * into s from public.market_suggestions where id = p_id for update;
  if not found then raise exception 'La sugerencia no existe'; end if;
  if s.status <> 'pending' then raise exception 'Esta sugerencia ya fue revisada'; end if;

  if p_action = 'reject' then
    update public.market_suggestions
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
        reject_reason = nullif(left(btrim(coalesce(p_reason, '')), 200), '')
    where id = p_id;
    insert into public.notifications (user_id, kind, payload)
    values (s.user_id, 'SUGGESTION_REJECTED',
            jsonb_build_object('question', s.question, 'reason', nullif(left(btrim(coalesce(p_reason, '')), 200), '')));
    perform public.log_admin_action('reject_suggestion', s.user_id, null, jsonb_build_object('question', s.question));
    return json_build_object('success', true, 'status', 'rejected');
  end if;

  v_q    := coalesce(nullif(btrim(p_question), ''), s.question);
  v_desc := case when p_description is null then s.description else nullif(btrim(p_description), '') end;
  v_cat  := coalesce(nullif(btrim(p_category), ''), s.category);

  if coalesce(array_length(s.options, 1), 0) >= 2 then
    v_group := gen_random_uuid();
    foreach v_opt in array s.options loop
      v_ids := v_ids || public._create_market(v_opt, v_desc, v_cat, p_closes_at, p_image_url, p_image_thumb_url,
                                              p_image_color, p_target_users, v_q, v_group, auth.uid());
    end loop;
  else
    v_ids := array[public._create_market(v_q, v_desc, v_cat, p_closes_at, p_image_url, p_image_thumb_url,
                                         p_image_color, p_target_users, null, null, auth.uid())];
  end if;
  v_first := v_ids[1];

  update public.market_suggestions
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), market_id = v_first
  where id = p_id;
  insert into public.notifications (user_id, kind, market_id, payload)
  values (s.user_id, 'SUGGESTION_APPROVED', v_first, jsonb_build_object('question', v_q));
  perform public.log_admin_action('approve_suggestion', s.user_id, null,
    jsonb_build_object('question', v_q, 'market_id', v_first, 'options', array_length(v_ids, 1)));
  return json_build_object('success', true, 'status', 'approved', 'ids', v_ids, 'group_id', v_group);
end $$;

-- ---------------------------------------------------------------------
-- 4. Motor: compra / venta (+ fecha de cierre, visibilidad, foto de patrimonio)
-- ---------------------------------------------------------------------
create or replace function public.buy_shares(
  p_market_id  uuid,
  p_side       text,
  p_investment numeric,
  p_max_price  numeric default null,
  p_request_id uuid    default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '6s'
as $$
declare
  v_uid         uuid := auth.uid();
  cfg           public.game_settings;
  v_market      public.markets;
  v_balance     numeric;
  v_new_balance numeric;
  v_used        int;
  v_inv         numeric;
  v_fee         numeric;
  v_net         numeric;
  v_k           numeric;
  v_yes         numeric;
  v_no          numeric;
  v_other       numeric;
  v_sel         numeric;
  v_swap        numeric;
  v_shares      numeric;
  v_avg         numeric;
  v_final       numeric;
  v_result      json;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  if p_side is null or p_side not in ('YES', 'NO') then raise exception 'Lado inválido'; end if;
  select * into cfg from public.game_settings limit 1;

  v_inv := round(p_investment, 4);
  if v_inv is null or v_inv = 'NaN'::numeric or v_inv > 1000000000 or v_inv < cfg.min_trade then
    raise exception 'La inversión mínima es $%', cfg.min_trade;
  end if;

  select * into v_market from public.markets where id = p_market_id for update;
  if not found or not public.can_see_market(v_market.target_users, v_market.created_by) then
    raise exception 'El mercado no existe';
  end if;
  if v_market.closed then raise exception 'El mercado está cerrado'; end if;
  if v_market.closes_at is not null and now() >= v_market.closes_at then
    raise exception 'Las apuestas de este mercado ya cerraron. Está esperando su resolución.';
  end if;

  select balance into v_balance from public.profiles where id = v_uid for update;
  if not found then raise exception 'Perfil no encontrado'; end if;

  if p_request_id is not null then
    select result into v_result from public.trade_requests where request_id = p_request_id and user_id = v_uid;
    if found then return v_result; end if;
  end if;

  v_used := public.daily_moves_used(v_uid);
  if v_used >= cfg.daily_limit then
    raise exception 'Límite de % movimientos diarios alcanzado', cfg.daily_limit;
  end if;
  if v_balance < v_inv then
    raise exception 'Saldo insuficiente. Tienes $%', round(v_balance, 2);
  end if;

  v_yes := v_market.yes_pool;
  v_no  := v_market.no_pool;
  v_fee := round(v_inv * cfg.fee_rate, 4);
  v_net := v_inv - v_fee;
  v_k   := v_yes * v_no;

  if p_side = 'YES' then
    v_other := v_no + v_net;   v_sel := v_k / v_other;  v_swap := v_yes - v_sel;
    v_yes := v_sel;            v_no := v_other;
  else
    v_other := v_yes + v_net;  v_sel := v_k / v_other;  v_swap := v_no - v_sel;
    v_no := v_sel;             v_yes := v_other;
  end if;

  v_shares := round(v_net + v_swap, 6);
  if v_shares <= 0 then raise exception 'La inversión es demasiado pequeña'; end if;
  v_avg := v_inv / v_shares;

  v_final := case when p_side = 'YES' then v_no / (v_yes + v_no) else v_yes / (v_yes + v_no) end;
  if v_final > cfg.max_price then
    raise exception 'El precio excedería el límite de %¢. Inversión demasiado grande.', round(cfg.max_price * 100);
  end if;
  if p_max_price is not null and v_avg > p_max_price then
    raise exception 'El precio cambió: pagarías %¢ por acción y tu máximo es %¢. Aumenta la tolerancia o reintenta.',
      round(v_avg * 100, 2), round(p_max_price * 100, 2);
  end if;

  update public.profiles set balance = round(balance - v_inv, 4)
  where id = v_uid returning balance into v_new_balance;

  update public.markets set yes_pool = v_yes, no_pool = v_no where id = p_market_id;

  insert into public.shares (user_id, market_id, side, count)
  values (v_uid, p_market_id, p_side, v_shares)
  on conflict (user_id, market_id, side)
  do update set count = public.shares.count + excluded.count, updated_at = now();

  insert into public.transactions (user_id, market_id, type, side, shares_amount, price_per_share, total_cost)
  values (v_uid, p_market_id, 'BUY', p_side, v_shares, v_avg, v_inv);
  insert into public.transaction_logs (user_id, market_id, action, side, amount, price, total_cost)
  values (v_uid, p_market_id, 'BUY', p_side, v_shares, v_avg, v_inv);
  insert into public.market_prices_history (market_id, yes_price, no_price, yes_pool, no_pool)
  values (p_market_id, v_no / (v_yes + v_no), v_yes / (v_yes + v_no), v_yes, v_no);

  perform public._snapshot_networth(false);

  v_result := json_build_object(
    'success', true,
    'shares_bought', v_shares,
    'price', v_avg,
    'final_price', v_final,
    'investment', v_inv,
    'fee_paid', v_fee,
    'daily_moves_remaining', cfg.daily_limit - v_used - 1,
    'new_balance', v_new_balance,
    'yes_pool', v_yes,
    'no_pool', v_no
  );

  if p_request_id is not null then
    insert into public.trade_requests (request_id, user_id, result)
    values (p_request_id, v_uid, v_result) on conflict do nothing;
  end if;
  if random() < 0.01 then
    delete from public.trade_requests where created_at < now() - interval '3 days';
  end if;

  return v_result;
end $$;

create or replace function public.sell_shares(
  p_market_id      uuid,
  p_side           text,
  p_shares_to_sell numeric,
  p_min_price      numeric default null,
  p_request_id     uuid    default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '6s'
as $$
declare
  v_uid         uuid := auth.uid();
  cfg           public.game_settings;
  v_market      public.markets;
  v_balance     numeric;
  v_new_balance numeric;
  v_used        int;
  v_s           numeric;
  v_owned       numeric;
  v_yes         numeric;
  v_no          numeric;
  v_y           numeric;
  v_n           numeric;
  v_k           numeric;
  v_b           numeric;
  v_c           numeric;
  v_disc        numeric;
  v_swap        numeric;
  v_gross       numeric;
  v_fee         numeric;
  v_payout      numeric;
  v_avg         numeric;
  v_final       numeric;
  v_result      json;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  if p_side is null or p_side not in ('YES', 'NO') then raise exception 'Lado inválido'; end if;
  select * into cfg from public.game_settings limit 1;

  v_s := round(p_shares_to_sell, 6);
  if v_s is null or v_s = 'NaN'::numeric or v_s <= 0 or v_s > 1000000000 then
    raise exception 'Cantidad inválida';
  end if;

  select * into v_market from public.markets where id = p_market_id for update;
  if not found or not public.can_see_market(v_market.target_users, v_market.created_by) then
    raise exception 'El mercado no existe';
  end if;
  if v_market.closed then raise exception 'El mercado está cerrado'; end if;
  if v_market.closes_at is not null and now() >= v_market.closes_at then
    raise exception 'Las apuestas de este mercado ya cerraron. Está esperando su resolución.';
  end if;

  select balance into v_balance from public.profiles where id = v_uid for update;
  if not found then raise exception 'Perfil no encontrado'; end if;

  if p_request_id is not null then
    select result into v_result from public.trade_requests where request_id = p_request_id and user_id = v_uid;
    if found then return v_result; end if;
  end if;

  v_used := public.daily_moves_used(v_uid);
  if v_used >= cfg.daily_limit then
    raise exception 'Límite de % movimientos diarios alcanzado', cfg.daily_limit;
  end if;

  select count into v_owned from public.shares
  where user_id = v_uid and market_id = p_market_id and side = p_side for update;
  if coalesce(v_owned, 0) < v_s then raise exception 'No tienes suficientes acciones'; end if;

  v_yes := v_market.yes_pool;
  v_no  := v_market.no_pool;
  v_k   := v_yes * v_no;
  if p_side = 'YES' then v_y := v_yes; v_n := v_no; else v_y := v_no; v_n := v_yes; end if;

  v_b    := v_y + v_n - v_s;
  v_c    := v_y * (v_n - v_s) - v_k;
  v_disc := v_b * v_b - 4 * v_c;
  if v_disc < 0 then raise exception 'La cantidad es demasiado alta para vender'; end if;
  v_swap := (-v_b + sqrt(v_disc)) / 2;
  if v_swap < -0.000001 or v_swap > v_s + 0.000001 then
    raise exception 'Error en el cálculo de venta';
  end if;
  v_swap := least(greatest(v_swap, 0), v_s);

  v_gross  := v_s - v_swap;
  v_fee    := round(v_gross * cfg.fee_rate, 4);
  v_payout := round(v_gross - v_fee, 4);
  if v_payout <= 0 then raise exception 'El monto de venta es muy bajo'; end if;
  v_avg := v_payout / v_s;

  if p_side = 'YES' then
    v_yes := v_yes + v_swap;  v_no := v_k / v_yes;
  else
    v_no := v_no + v_swap;    v_yes := v_k / v_no;
  end if;
  v_final := case when p_side = 'YES' then v_no / (v_yes + v_no) else v_yes / (v_yes + v_no) end;
  if v_final < cfg.min_price then
    raise exception 'El precio caería por debajo de %¢. Vende una cantidad menor.', round(cfg.min_price * 100);
  end if;
  if p_min_price is not null and v_avg < p_min_price then
    raise exception 'El precio cambió: recibirías %¢ por acción y tu mínimo es %¢. Reduce la tolerancia o reintenta.',
      round(v_avg * 100, 2), round(p_min_price * 100, 2);
  end if;

  update public.markets set yes_pool = v_yes, no_pool = v_no where id = p_market_id;
  update public.profiles set balance = round(balance + v_payout, 4)
  where id = v_uid returning balance into v_new_balance;
  update public.shares set count = round(count - v_s, 6), updated_at = now()
  where user_id = v_uid and market_id = p_market_id and side = p_side;

  insert into public.transactions (user_id, market_id, type, side, shares_amount, price_per_share, total_cost)
  values (v_uid, p_market_id, 'SELL', p_side, v_s, v_avg, v_payout);
  insert into public.transaction_logs (user_id, market_id, action, side, amount, price, total_cost)
  values (v_uid, p_market_id, 'SELL', p_side, v_s, v_avg, v_payout);
  insert into public.market_prices_history (market_id, yes_price, no_price, yes_pool, no_pool)
  values (p_market_id, v_no / (v_yes + v_no), v_yes / (v_yes + v_no), v_yes, v_no);

  perform public._snapshot_networth(false);

  v_result := json_build_object(
    'success', true,
    'shares_sold', v_s,
    'payout', v_payout,
    'fee_paid', v_fee,
    'price', v_avg,
    'final_price', v_final,
    'daily_moves_remaining', cfg.daily_limit - v_used - 1,
    'new_balance', v_new_balance,
    'yes_pool', v_yes,
    'no_pool', v_no
  );

  if p_request_id is not null then
    insert into public.trade_requests (request_id, user_id, result)
    values (p_request_id, v_uid, v_result) on conflict do nothing;
  end if;

  return v_result;
end $$;

-- ---------------------------------------------------------------------
-- 5. Resolver (dueño o moderadores) con avisos a los participantes
-- ---------------------------------------------------------------------
create or replace function public.resolve_market(p_market_id uuid, p_outcome text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_market   public.markets;
  v_total    numeric;
  v_winners  int;
  v_notified int;
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Solo administradores o moderadores pueden resolver mercados';
  end if;
  if p_outcome is null or p_outcome not in ('YES', 'NO') then
    raise exception 'El resultado debe ser YES o NO';
  end if;

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

  update public.markets set closed = true, outcome = p_outcome, resolved_at = now() where id = p_market_id;
  perform public._snapshot_networth(true);

  perform public.log_admin_action('resolve_market', null, v_total,
    jsonb_build_object('market_id', p_market_id, 'question', v_market.question, 'outcome', p_outcome, 'winners', v_winners));

  return json_build_object('success', true, 'outcome', p_outcome, 'total_paid', v_total,
                           'winners', v_winners, 'notified', v_notified);
end $$;

-- Deshacer una resolucion equivocada (solo el dueño): revierte los pagos y reabre el mercado
create or replace function public.admin_reopen_market(p_market_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m         public.markets;
  r         record;
  v_bal     numeric;
  v_users   int := 0;
  v_clamped int := 0;
  v_total   numeric := 0;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño puede deshacer una resolución'; end if;
  select * into m from public.markets where id = p_market_id for update;
  if not found then raise exception 'El mercado no existe'; end if;
  if not m.closed then raise exception 'El mercado no está resuelto'; end if;

  for r in
    select t.user_id, sum(t.total_cost) as payout
    from public.transactions t
    where t.market_id = p_market_id and t.type = 'RESOLVE'
    group by t.user_id
  loop
    select balance into v_bal from public.profiles where id = r.user_id for update;
    if v_bal - r.payout < 0 then v_clamped := v_clamped + 1; end if;
    update public.profiles set balance = greatest(round(v_bal - r.payout, 4), 0) where id = r.user_id;
    v_users := v_users + 1;
    v_total := v_total + r.payout;
    insert into public.notifications (user_id, kind, market_id, payload)
    values (r.user_id, 'MARKET_REOPENED', p_market_id, jsonb_build_object('question', m.question, 'reversed', r.payout));
  end loop;

  delete from public.transactions where market_id = p_market_id and type = 'RESOLVE';
  delete from public.notifications where market_id = p_market_id and kind in ('MARKET_WON', 'MARKET_LOST');

  insert into public.notifications (user_id, kind, market_id, payload)
  select distinct s.user_id, 'MARKET_REOPENED', p_market_id, jsonb_build_object('question', m.question, 'reversed', 0)
  from public.shares s
  where s.market_id = p_market_id and s.count > 0
    and not exists (select 1 from public.notifications n
                    where n.user_id = s.user_id and n.market_id = p_market_id and n.kind = 'MARKET_REOPENED');

  update public.markets set closed = false, outcome = 'PENDING', resolved_at = null where id = p_market_id;
  perform public._snapshot_networth(true);
  perform public.log_admin_action('reopen_market', null, v_total,
    jsonb_build_object('market_id', p_market_id, 'question', m.question, 'users', v_users, 'clamped_users', v_clamped));
  return json_build_object('success', true, 'users', v_users, 'reversed', v_total, 'clamped_users', v_clamped);
end $$;

-- Anular: ahora tambien avisa a los jugadores del reembolso
create or replace function public.delete_market_and_refund(p_market_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_q        text;
  v_users    int;
  v_refunded numeric;
  v_clamped  int;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Solo el dueño puede anular mercados';
  end if;
  select question into v_q from public.markets where id = p_market_id for update;
  if not found then raise exception 'El mercado no existe'; end if;

  with net as (
    select user_id,
           sum(case type when 'BUY' then total_cost else -total_cost end) as amount
    from public.transactions where market_id = p_market_id group by user_id
  ), calc as (
    select n.user_id, n.amount, p.balance as old_balance
    from net n join public.profiles p on p.id = n.user_id
    for update of p
  ), upd as (
    update public.profiles p
    set balance = greatest(round(c.old_balance + c.amount, 4), 0)
    from calc c where p.id = c.user_id
    returning c.user_id, c.amount, (c.old_balance + c.amount < 0) as clamped
  ), notes as (
    insert into public.notifications (user_id, kind, payload)
    select u.user_id, 'MARKET_CANCELLED', jsonb_build_object('question', v_q, 'refunded', u.amount)
    from upd u
    returning 1
  )
  select count(*)::int, coalesce(sum(amount), 0), (count(*) filter (where clamped))::int
  into v_users, v_refunded, v_clamped from upd;

  delete from public.markets where id = p_market_id;
  perform public._snapshot_networth(true);

  perform public.log_admin_action('delete_market', null, v_refunded,
    jsonb_build_object('market_id', p_market_id, 'question', v_q, 'users', v_users, 'clamped_users', v_clamped));
  return json_build_object('success', true, 'users', v_users, 'net_refunded', v_refunded, 'clamped_users', v_clamped);
end $$;

-- ---------------------------------------------------------------------
-- 6. Lecturas: precios ligeros (sondeo), historial, actividad
-- ---------------------------------------------------------------------
-- Una sola consulta pequeña cada ~12 s: precios + estadisticas para "tendencia".
-- El resto (texto, imagen...) se descarga solo cuando cambia static_rev.
create or replace function public.get_market_prices()
returns table (id uuid, yes_pool numeric, no_pool numeric, closed boolean, outcome text, closes_at timestamptz,
               static_rev int, trades_24h int, traders_24h int, trades_total int, score numeric, yes_price_24h numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  return query
  select m.id, m.yes_pool, m.no_pool, m.closed, m.outcome, m.closes_at, m.static_rev,
         coalesce(st.t24, 0)::int, coalesce(st.u24, 0)::int, coalesce(st.tt, 0)::int,
         (coalesce(st.t3, 0) * 4 + coalesce(st.t24, 0) + coalesce(st.u24, 0) * 2
          + case when m.created_at > now() - interval '6 hours' then 3 else 0 end)::numeric,
         case when m.closed then null else coalesce(h24.p, 0.5) end
  from public.markets m
  left join lateral (
    select count(*) filter (where t.created_at > now() - interval '24 hours') as t24,
           count(distinct t.user_id) filter (where t.created_at > now() - interval '24 hours') as u24,
           count(*) filter (where t.created_at > now() - interval '3 hours') as t3,
           count(*) as tt
    from public.transactions t where t.market_id = m.id and t.type in ('BUY', 'SELL')
  ) st on true
  left join lateral (
    select h.yes_price as p from public.market_prices_history h
    where h.market_id = m.id and h.created_at <= now() - interval '24 hours'
    order by h.created_at desc limit 1
  ) h24 on true
  where public.can_see_market(m.target_users, m.created_by)
  order by m.created_at desc;
end $$;

drop function if exists public.get_market_history(uuid, int);
create or replace function public.get_market_history(p_market_id uuid, p_limit int default 150, p_since timestamptz default null)
returns table (created_at timestamptz, yes_price numeric, no_price numeric)
language sql
stable
set search_path = public, pg_temp
as $$
  with src as (
    select mh.created_at, mh.yes_price, mh.no_price, mh.id
    from public.market_prices_history mh
    where mh.market_id = p_market_id and (p_since is null or mh.created_at >= p_since)
    union all
    -- punto de anclaje: ultimo precio conocido ANTES de la ventana, para que la linea empiece donde corresponde
    (select p_since, mh.yes_price, mh.no_price, mh.id
     from public.market_prices_history mh
     where p_since is not null and mh.market_id = p_market_id and mh.created_at < p_since
     order by mh.created_at desc limit 1)
  ), hh as (
    select s.created_at, s.yes_price, s.no_price,
           row_number() over (order by s.created_at, s.id) as rn,
           count(*) over () as cnt
    from src s
  )
  select hh.created_at, hh.yes_price, hh.no_price
  from hh
  where hh.cnt <= greatest(p_limit, 10)
     or hh.rn = 1 or hh.rn = hh.cnt
     or hh.rn % ceil(hh.cnt::numeric / greatest(p_limit, 10))::int = 0
  order by hh.created_at
$$;

create or replace function public.get_group_history(p_group_id uuid, p_limit int default 100, p_since timestamptz default null)
returns table (market_id uuid, created_at timestamptz, yes_price numeric)
language sql
stable
set search_path = public, pg_temp
as $$
  with src as (
    select mh.market_id, mh.created_at, mh.yes_price, mh.id
    from public.market_prices_history mh
    join public.markets m on m.id = mh.market_id
    where m.group_id = p_group_id and (p_since is null or mh.created_at >= p_since)
    union all
    (select m.id, p_since, mh.yes_price, mh.id
     from public.markets m
     join lateral (select h.yes_price, h.id from public.market_prices_history h
                   where h.market_id = m.id and h.created_at < p_since order by h.created_at desc limit 1) mh on true
     where p_since is not null and m.group_id = p_group_id)
  ), hh as (
    select s.market_id, s.created_at, s.yes_price,
           row_number() over (partition by s.market_id order by s.created_at, s.id) as rn,
           count(*) over (partition by s.market_id) as cnt
    from src s
  )
  select hh.market_id, hh.created_at, hh.yes_price
  from hh
  where hh.cnt <= greatest(p_limit, 10)
     or hh.rn = 1 or hh.rn = hh.cnt
     or hh.rn % ceil(hh.cnt::numeric / greatest(p_limit, 10))::int = 0
  order by hh.market_id, hh.created_at
$$;

create index if not exists transactions_created_idx on public.transactions (created_at desc) where type in ('BUY', 'SELL');
create index if not exists transactions_market_created_idx on public.transactions (market_id, created_at desc);

-- Feed de actividad: operaciones, mercados nuevos y resultados (respeta el filtro fantasma)
create or replace function public.get_recent_activity(p_limit int default 20, p_market_id uuid default null, p_group_id uuid default null)
returns table (kind text, at timestamptz, username text, market_id uuid, question text, group_topic text,
               side text, amount numeric, outcome text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_lim int := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  return query
  select e.kind, e.at, e.username, e.market_id, e.question, e.group_topic, e.side, e.amount, e.outcome
  from (
    (select t.type::text as kind, t.created_at as at, p.username, t.market_id, m.question, m.group_topic,
            t.side::text as side, t.total_cost as amount, null::text as outcome
     from public.transactions t
     join public.markets m on m.id = t.market_id
     join public.profiles p on p.id = t.user_id
     where t.type in ('BUY', 'SELL')
       and public.can_see_market(m.target_users, m.created_by)
       and (p_market_id is null or t.market_id = p_market_id)
       and (p_group_id is null or m.group_id = p_group_id)
     order by t.created_at desc limit v_lim)
    union all
    (select 'MARKET_NEW'::text, m.created_at, cp.username, m.id, m.question, m.group_topic,
            null::text, null::numeric, null::text
     from (select x.*, row_number() over (partition by coalesce(x.group_id, x.id) order by x.id) as rn
           from public.markets x
           where public.can_see_market(x.target_users, x.created_by)
             and (p_market_id is null or x.id = p_market_id)
             and (p_group_id is null or x.group_id = p_group_id)) m
     left join public.profiles cp on cp.id = m.created_by
     where m.rn = 1
     order by m.created_at desc limit v_lim)
    union all
    (select 'MARKET_RESOLVED'::text, m.resolved_at, null::text, m.id, m.question, m.group_topic,
            null::text, null::numeric, m.outcome
     from public.markets m
     where m.closed and m.resolved_at is not null
       and public.can_see_market(m.target_users, m.created_by)
       and (p_market_id is null or m.id = p_market_id)
       and (p_group_id is null or m.group_id = p_group_id)
     order by m.resolved_at desc limit v_lim)
  ) e
  order by e.at desc
  limit v_lim;
end $$;

-- ---------------------------------------------------------------------
-- 7. Permisos
-- ---------------------------------------------------------------------
revoke all on function public.mark_notifications_seen(uuid[]) from public, anon;
revoke all on function public.get_session_state() from public, anon;
revoke all on function public.suggest_market(text, text, text, text[]) from public, anon;
revoke all on function public.get_my_suggestions() from public, anon;
revoke all on function public.staff_list_suggestions(text) from public, anon;
revoke all on function public.staff_review_suggestion(uuid, text, text, text, text, text, timestamptz, text, text, text, uuid[]) from public, anon;
revoke all on function public.buy_shares(uuid, text, numeric, numeric, uuid) from public, anon;
revoke all on function public.sell_shares(uuid, text, numeric, numeric, uuid) from public, anon;
revoke all on function public.resolve_market(uuid, text) from public, anon;
revoke all on function public.admin_reopen_market(uuid) from public, anon;
revoke all on function public.delete_market_and_refund(uuid) from public, anon;
revoke all on function public.get_market_prices() from public, anon;
revoke all on function public.get_market_history(uuid, int, timestamptz) from public, anon;
revoke all on function public.get_group_history(uuid, int, timestamptz) from public, anon;
revoke all on function public.get_recent_activity(int, uuid, uuid) from public, anon;

grant execute on function public.mark_notifications_seen(uuid[]) to authenticated;
grant execute on function public.get_session_state() to authenticated;
grant execute on function public.suggest_market(text, text, text, text[]) to authenticated;
grant execute on function public.get_my_suggestions() to authenticated;
grant execute on function public.staff_list_suggestions(text) to authenticated;
grant execute on function public.staff_review_suggestion(uuid, text, text, text, text, text, timestamptz, text, text, text, uuid[]) to authenticated;
grant execute on function public.buy_shares(uuid, text, numeric, numeric, uuid) to authenticated;
grant execute on function public.sell_shares(uuid, text, numeric, numeric, uuid) to authenticated;
grant execute on function public.resolve_market(uuid, text) to authenticated;
grant execute on function public.admin_reopen_market(uuid) to authenticated;
grant execute on function public.delete_market_and_refund(uuid) to authenticated;
grant execute on function public.get_market_prices() to authenticated;
grant execute on function public.get_market_history(uuid, int, timestamptz) to authenticated;
grant execute on function public.get_group_history(uuid, int, timestamptz) to authenticated;
grant execute on function public.get_recent_activity(int, uuid, uuid) to authenticated;
