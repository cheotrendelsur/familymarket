-- =====================================================================
-- 002 · SEGURIDAD (RLS / privilegios) + MOTOR DE TRADING REESCRITO
-- =====================================================================
-- Corrige las vulnerabilidades del esquema original:
--   * admin_update_balance y delete_market_and_refund no verificaban admin
--   * shares / logs / historial eran escribibles por cualquiera (incluso anon)
--   * cualquier jugador podia editar su propio balance / is_admin
--   * sell_shares no comprobaba mercado cerrado (doble cobro tras resolver)
--   * p_max_price (slippage) se ignoraba; lecturas sin bloqueo (carreras)
-- Orden global de bloqueos (evita deadlocks): mercado -> perfil -> acciones.
-- Dinero a 4 decimales, acciones a 6 decimales.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Configuracion del juego (una sola fila)
-- ---------------------------------------------------------------------
create table if not exists public.game_settings (
  id                boolean primary key default true check (id),
  daily_limit       int     not null default 60   check (daily_limit > 0),
  fee_rate          numeric not null default 0.02 check (fee_rate >= 0 and fee_rate < 0.5),
  initial_liquidity numeric not null default 1200 check (initial_liquidity > 0),
  initial_balance   numeric not null default 1000 check (initial_balance >= 0),
  min_price         numeric not null default 0.01,
  max_price         numeric not null default 0.99,
  min_trade         numeric not null default 0.01,
  timezone          text    not null default 'America/Caracas'
);
insert into public.game_settings (id) values (true) on conflict do nothing;
alter table public.game_settings enable row level security;

-- Auditoria de acciones de administrador
create table if not exists public.admin_actions (
  id          bigint generated always as identity primary key,
  admin_id    uuid,
  action      text not null,
  target_user uuid,
  amount      numeric,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
alter table public.admin_actions enable row level security;

-- Idempotencia de operaciones (doble toque / reintentos de red)
create table if not exists public.trade_requests (
  request_id uuid primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  result     json not null
);
create index if not exists trade_requests_created_idx on public.trade_requests (created_at);
alter table public.trade_requests enable row level security;

-- ---------------------------------------------------------------------
-- 1. Funciones auxiliares
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- Inicio del "dia de juego" en la zona horaria configurada (Venezuela)
create or replace function public.game_day_start()
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$
  select (date_trunc('day', now() at time zone s.timezone)) at time zone s.timezone
  from public.game_settings s limit 1
$$;

create or replace function public.daily_moves_used(p_user uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select count(*)::int from public.transaction_logs
  where user_id = p_user and created_at >= public.game_day_start() and action in ('BUY', 'SELL')
$$;

create or replace function public.log_admin_action(p_action text, p_target uuid, p_amount numeric, p_detail jsonb)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.admin_actions (admin_id, action, target_user, amount, detail)
  values (auth.uid(), p_action, p_target, p_amount, p_detail)
$$;

-- ---------------------------------------------------------------------
-- 2. Limpieza de politicas y privilegios originales
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

-- ---------------------------------------------------------------------
-- 3. Integridad de datos
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'markets'
               and column_name = 'target_users' and udt_name <> '_uuid') then
    alter table public.markets alter column target_users type uuid[] using target_users::text[]::uuid[];
  end if;
end $$;

alter table public.markets drop constraint if exists markets_yes_pool_check;
alter table public.markets drop constraint if exists markets_no_pool_check;
alter table public.markets drop constraint if exists markets_pools_positive;
alter table public.markets add constraint markets_pools_positive check (yes_pool > 0 and no_pool > 0);

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[A-Za-z0-9_]{3,20}$');
create unique index if not exists profiles_username_lower_key on public.profiles (lower(username)) where username is not null;

drop index if exists public.idx_profiles_username;
drop index if exists public.idx_shares_user_market;
create index if not exists shares_market_idx on public.shares (market_id) where count > 0;
create index if not exists transactions_market_idx on public.transactions (market_id);
create index if not exists transactions_user_market_idx on public.transactions (user_id, market_id, side, created_at);
create index if not exists markets_closed_created_idx on public.markets (closed, created_at desc);

-- ---------------------------------------------------------------------
-- 4. RLS: solo lectura para usuarios autenticados. Toda escritura va por RPC.
-- ---------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

-- "Filtro fantasma": el mercado se oculta en el SERVIDOR a los usuarios de target_users
create policy markets_select on public.markets for select to authenticated
  using ((select public.is_admin())
         or coalesce(array_length(target_users, 1), 0) = 0
         or not ((select auth.uid())::text = any (target_users::text[])));

create policy shares_select on public.shares for select to authenticated
  using (user_id = (select auth.uid()));

create policy transactions_select on public.transactions for select to authenticated
  using (user_id = (select auth.uid()));

create policy logs_select on public.transaction_logs for select to authenticated
  using (user_id = (select auth.uid()));

create policy history_select on public.market_prices_history for select to authenticated
  using (exists (select 1 from public.markets m where m.id = market_id));

create policy settings_select on public.game_settings for select to authenticated using (true);

create policy admin_actions_select on public.admin_actions for select to authenticated
  using ((select public.is_admin()));

grant select on public.profiles, public.markets, public.shares, public.transactions,
                public.transaction_logs, public.market_prices_history,
                public.game_settings, public.admin_actions to authenticated;

-- ---------------------------------------------------------------------
-- 5. Alta de usuario nuevo
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, balance, is_admin)
  values (new.id, new.email, (select initial_balance from public.game_settings limit 1), false)
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.set_username(p_username text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(p_username);
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  if v_name is null or v_name !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'Usa de 3 a 20 caracteres: letras, números o guion bajo';
  end if;
  if exists (select 1 from public.profiles where lower(username) = lower(v_name) and id <> v_uid) then
    raise exception 'Este nombre ya está en uso';
  end if;
  update public.profiles set username = v_name where id = v_uid and username is null;
  if not found then raise exception 'Tu nombre de usuario ya fue elegido'; end if;
exception
  when unique_violation then raise exception 'Este nombre ya está en uso';
end $$;

-- ---------------------------------------------------------------------
-- 6. MOTOR: compra (mint & swap) y venta (reverse mint)
-- ---------------------------------------------------------------------
drop function if exists public.buy_shares(uuid, text, numeric, numeric);
drop function if exists public.sell_shares(uuid, text, numeric, numeric);
drop function if exists public.create_market_with_liquidity(text, text, text);
drop function if exists public.resolve_market(uuid, text);
drop function if exists public.delete_market_and_refund(uuid);
drop function if exists public.admin_update_balance(uuid, numeric);

create or replace function public.buy_shares(
  p_market_id  uuid,
  p_side       text,
  p_investment numeric,
  p_max_price  numeric default null,   -- precio PROMEDIO maximo aceptado (slippage)
  p_request_id uuid    default null    -- idempotencia
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

  -- Bloqueo 1: mercado (serializa todas las operaciones del mismo mercado)
  select * into v_market from public.markets where id = p_market_id for update;
  if not found
     or (coalesce(array_length(v_market.target_users, 1), 0) > 0
         and v_uid::text = any (v_market.target_users::text[])
         and not public.is_admin()) then
    raise exception 'El mercado no existe';
  end if;
  if v_market.closed then raise exception 'El mercado está cerrado'; end if;

  -- Bloqueo 2: perfil (serializa las operaciones del mismo usuario)
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
  p_min_price      numeric default null,   -- precio PROMEDIO minimo aceptado (slippage)
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
  if not found
     or (coalesce(array_length(v_market.target_users, 1), 0) > 0
         and v_uid::text = any (v_market.target_users::text[])
         and not public.is_admin()) then
    raise exception 'El mercado no existe';
  end if;
  if v_market.closed then raise exception 'El mercado está cerrado'; end if;

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

  -- Reverse mint: se resuelve swap^2 + b*swap + c = 0
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
-- 7. ADMIN: crear / resolver / anular mercados y ajustar saldos
-- ---------------------------------------------------------------------
create or replace function public.admin_create_market(
  p_question     text,
  p_description  text   default null,
  p_image_url    text   default null,
  p_group_topic  text   default null,
  p_target_users uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg      public.game_settings;
  v_q      text := btrim(p_question);
  v_topic  text := nullif(btrim(p_group_topic), '');
  v_desc   text := nullif(btrim(p_description), '');
  v_img    text := nullif(btrim(p_image_url), '');
  v_id     uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Solo administradores pueden crear mercados';
  end if;
  if v_q is null or char_length(v_q) < 3 or char_length(v_q) > 200 then
    raise exception 'La pregunta debe tener entre 3 y 200 caracteres';
  end if;
  if v_topic is not null and char_length(v_topic) > 120 then raise exception 'El tópico es demasiado largo'; end if;
  if v_desc is not null and char_length(v_desc) > 1000 then raise exception 'La descripción es demasiado larga'; end if;
  if v_img is not null and v_img !~* '^https?://' then raise exception 'La imagen debe ser una URL http(s)'; end if;

  select * into cfg from public.game_settings limit 1;
  insert into public.markets (question, description, image_url, yes_pool, no_pool, outcome, closed, group_topic, target_users)
  values (v_q, v_desc, v_img, cfg.initial_liquidity, cfg.initial_liquidity, 'PENDING', false, v_topic,
          case when coalesce(array_length(p_target_users, 1), 0) > 0 then p_target_users else null end)
  returning id into v_id;

  insert into public.market_prices_history (market_id, yes_price, no_price, yes_pool, no_pool)
  values (v_id, 0.5, 0.5, cfg.initial_liquidity, cfg.initial_liquidity);

  perform public.log_admin_action('create_market', null, null, jsonb_build_object('market_id', v_id, 'question', v_q));
  return v_id;
end $$;

create or replace function public.admin_create_market_group(
  p_topic        text,
  p_options      text[],
  p_description  text   default null,
  p_image_url    text   default null,
  p_target_users uuid[] default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_opt   text;
  v_ids   uuid[] := '{}';
  v_clean text[];
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Solo administradores pueden crear mercados';
  end if;
  if nullif(btrim(p_topic), '') is null then raise exception 'El tópico general es requerido'; end if;
  select coalesce(array_agg(btrim(o)), '{}') into v_clean
  from unnest(p_options) o where nullif(btrim(o), '') is not null;
  if coalesce(array_length(v_clean, 1), 0) < 2 then raise exception 'Debes ingresar al menos 2 opciones'; end if;
  if coalesce(array_length(v_clean, 1), 0) > 30 then raise exception 'Máximo 30 opciones por mercado múltiple'; end if;

  foreach v_opt in array v_clean loop
    v_ids := v_ids || public.admin_create_market(v_opt, p_description, p_image_url, p_topic, p_target_users);
  end loop;
  return json_build_object('created', array_length(v_ids, 1), 'ids', v_ids);
end $$;

create or replace function public.resolve_market(p_market_id uuid, p_outcome text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_market  public.markets;
  v_total   numeric;
  v_winners int;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Solo administradores pueden resolver mercados';
  end if;
  if p_outcome is null or p_outcome not in ('YES', 'NO') then
    raise exception 'El resultado debe ser YES o NO';
  end if;

  select * into v_market from public.markets where id = p_market_id for update;
  if not found then raise exception 'El mercado no existe'; end if;
  if v_market.closed then raise exception 'El mercado ya está cerrado'; end if;

  with winners as (
    select user_id, count as qty from public.shares
    where market_id = p_market_id and side = p_outcome and count > 0
  ), paid as (
    update public.profiles p set balance = round(p.balance + w.qty, 4)
    from winners w where p.id = w.user_id
    returning w.user_id, w.qty
  ), logged as (
    insert into public.transactions (user_id, market_id, type, side, shares_amount, price_per_share, total_cost)
    select user_id, p_market_id, 'RESOLVE', p_outcome, qty, 1.00, qty from paid
    returning 1
  )
  select coalesce((select sum(qty) from paid), 0), (select count(*) from paid)::int
  into v_total, v_winners;

  update public.markets set closed = true, outcome = p_outcome, resolved_at = now() where id = p_market_id;

  perform public.log_admin_action('resolve_market', null, v_total,
    jsonb_build_object('market_id', p_market_id, 'outcome', p_outcome, 'winners', v_winners));

  return json_build_object('success', true, 'outcome', p_outcome, 'total_paid', v_total, 'winners', v_winners);
end $$;

create or replace function public.delete_market_and_refund(p_market_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_users    int;
  v_refunded numeric;
  v_clamped  int;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Solo administradores pueden anular mercados';
  end if;
  perform 1 from public.markets where id = p_market_id for update;
  if not found then raise exception 'El mercado no existe'; end if;

  -- Neto de cada jugador = compras - ventas - pagos de resolucion (revierte todo el efecto del mercado)
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
    returning c.amount, (c.old_balance + c.amount < 0) as clamped
  )
  select count(*)::int, coalesce(sum(amount), 0), (count(*) filter (where clamped))::int
  into v_users, v_refunded, v_clamped from upd;

  delete from public.markets where id = p_market_id;   -- cascada: shares, transactions, logs, historial

  perform public.log_admin_action('delete_market', null, v_refunded,
    jsonb_build_object('market_id', p_market_id, 'users', v_users, 'clamped_users', v_clamped));

  return json_build_object('success', true, 'users', v_users, 'net_refunded', v_refunded, 'clamped_users', v_clamped);
end $$;

create or replace function public.admin_update_balance(p_user_id uuid, p_amount numeric)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_amount  numeric := round(p_amount, 4);
  v_balance numeric;
  v_new     numeric;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Solo administradores pueden modificar saldos';
  end if;
  if v_amount is null or v_amount = 'NaN'::numeric or v_amount = 0 or abs(v_amount) > 1000000000 then
    raise exception 'Monto inválido';
  end if;
  select balance into v_balance from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Jugador no encontrado'; end if;
  if v_balance + v_amount < 0 then
    raise exception 'El jugador solo tiene $% disponibles', round(v_balance, 2);
  end if;
  update public.profiles set balance = round(balance + v_amount, 4) where id = p_user_id returning balance into v_new;
  perform public.log_admin_action('update_balance', p_user_id, v_amount, jsonb_build_object('new_balance', v_new));
  return json_build_object('success', true, 'new_balance', v_new);
end $$;

-- ---------------------------------------------------------------------
-- 8. Permisos de ejecucion: solo usuarios autenticados
-- ---------------------------------------------------------------------
revoke all on function public.is_admin() from public, anon;
revoke all on function public.game_day_start() from public, anon;
revoke all on function public.daily_moves_used(uuid) from public, anon, authenticated;
revoke all on function public.log_admin_action(text, uuid, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.set_username(text) from public, anon;
revoke all on function public.buy_shares(uuid, text, numeric, numeric, uuid) from public, anon;
revoke all on function public.sell_shares(uuid, text, numeric, numeric, uuid) from public, anon;
revoke all on function public.admin_create_market(text, text, text, text, uuid[]) from public, anon;
revoke all on function public.admin_create_market_group(text, text[], text, text, uuid[]) from public, anon;
revoke all on function public.resolve_market(uuid, text) from public, anon;
revoke all on function public.delete_market_and_refund(uuid) from public, anon;
revoke all on function public.admin_update_balance(uuid, numeric) from public, anon;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.game_day_start() to authenticated;
grant execute on function public.set_username(text) to authenticated;
grant execute on function public.buy_shares(uuid, text, numeric, numeric, uuid) to authenticated;
grant execute on function public.sell_shares(uuid, text, numeric, numeric, uuid) to authenticated;
grant execute on function public.admin_create_market(text, text, text, text, uuid[]) to authenticated;
grant execute on function public.admin_create_market_group(text, text[], text, text, uuid[]) to authenticated;
grant execute on function public.resolve_market(uuid, text) to authenticated;
grant execute on function public.delete_market_and_refund(uuid) to authenticated;
grant execute on function public.admin_update_balance(uuid, numeric) to authenticated;
