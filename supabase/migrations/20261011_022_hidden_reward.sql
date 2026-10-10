-- Premio por mercado sorpresa: a quienes se les OCULTA un mercado se les paga automáticamente al resolverse.
--
-- Cálculo (ajustable por el dueño en Admin → Más):
--   volumen = suma de todo lo apostado en el mercado (compras)
--   «compartido» (por defecto): bolsa = volumen x 2 %, repartida en partes iguales entre las personas a las que se les ocultó
--   «cada uno»:                 cada persona recibe volumen x porcentaje
--   y nunca más de un tope por persona (por defecto $40).
-- 2 % es la comisión del juego: la bolsa equivale a lo que se quemó en comisiones por ese mercado, así que prácticamente no
-- crea dinero nuevo. Se paga dentro de la misma transacción que resuelve el mercado (todo o nada).

alter table public.game_settings add column if not exists hidden_reward_pct numeric not null default 0.02;
alter table public.game_settings add column if not exists hidden_reward_cap numeric not null default 40;
alter table public.game_settings add column if not exists hidden_reward_mode text not null default 'shared';
alter table public.game_settings drop constraint if exists game_settings_hidden_reward_check;
alter table public.game_settings add constraint game_settings_hidden_reward_check
  check (hidden_reward_pct >= 0 and hidden_reward_pct <= 0.2 and hidden_reward_cap >= 0 and hidden_reward_cap <= 1000
         and hidden_reward_mode in ('shared', 'each'));

alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions add constraint transactions_type_check check (type = any (array['BUY', 'SELL', 'RESOLVE', 'REWARD']));
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind = any (array[
  'MARKET_WON', 'MARKET_LOST', 'MARKET_REOPENED', 'MARKET_CANCELLED', 'SUGGESTION_APPROVED', 'SUGGESTION_REJECTED', 'HIDDEN_REWARD']));

create or replace function public.admin_set_reward(p_pct numeric, p_cap numeric, p_mode text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño puede cambiar el premio'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 0.2 then raise exception 'El porcentaje debe estar entre 0 y 20 por ciento'; end if;
  if p_cap is null or p_cap < 0 or p_cap > 1000 then raise exception 'El tope por persona debe estar entre $0 y $1000'; end if;
  if p_mode is null or p_mode not in ('shared', 'each') then raise exception 'Modo inválido'; end if;
  update public.game_settings set hidden_reward_pct = p_pct, hidden_reward_cap = p_cap, hidden_reward_mode = p_mode where id;
  perform public.log_admin_action('set_hidden_reward', null, null, jsonb_build_object('pct', p_pct, 'cap', p_cap, 'mode', p_mode));
  return json_build_object('success', true, 'pct', p_pct, 'cap', p_cap, 'mode', p_mode);
end $$;
revoke all on function public.admin_set_reward(numeric, numeric, text) from public, anon;
grant execute on function public.admin_set_reward(numeric, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- Resolver: paga a los ganadores y, si el mercado era sorpresa, el premio a quienes no pudieron participar
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
  if not public.is_admin() and v_market.created_by is distinct from auth.uid() then
    raise exception 'Solo puedes resolver los mercados que tú creaste';
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
               jsonb_build_object('amount', v_each, 'volume', v_volume, 'market_id', p_market_id) from upd;
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
-- Deshacer una resolución: también se devuelve el premio (sin avisar a quien no podía ver el mercado)
-- ---------------------------------------------------------------------
create or replace function public.admin_reopen_market(p_market_id uuid)
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
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
    select t.user_id, sum(t.total_cost) as payout, bool_or(t.type = 'RESOLVE') as was_player
    from public.transactions t
    where t.market_id = p_market_id and t.type in ('RESOLVE', 'REWARD')
    group by t.user_id
  loop
    select balance into v_bal from public.profiles where id = r.user_id for update;
    if v_bal - r.payout < 0 then v_clamped := v_clamped + 1; end if;
    update public.profiles set balance = greatest(round(v_bal - r.payout, 4), 0) where id = r.user_id;
    v_users := v_users + 1;
    v_total := v_total + r.payout;
    if r.was_player then
      insert into public.notifications (user_id, kind, market_id, payload)
      values (r.user_id, 'MARKET_REOPENED', p_market_id, jsonb_build_object('question', m.question, 'reversed', r.payout));
    end if;
  end loop;

  delete from public.transactions where market_id = p_market_id and type in ('RESOLVE', 'REWARD');
  delete from public.notifications where market_id = p_market_id and kind in ('MARKET_WON', 'MARKET_LOST');
  delete from public.notifications where kind = 'HIDDEN_REWARD' and payload ->> 'market_id' = p_market_id::text;

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

-- ---------------------------------------------------------------------
-- Anular un mercado: devuelve lo apostado y quita el premio; el aviso solo a quienes sí participaron
-- ---------------------------------------------------------------------
create or replace function public.delete_market_and_refund(p_market_id uuid)
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
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
           sum(case type when 'BUY' then total_cost else -total_cost end) as amount,
           bool_or(type in ('BUY', 'SELL')) as played
    from public.transactions where market_id = p_market_id group by user_id
  ), calc as (
    select n.user_id, n.amount, n.played, p.balance as old_balance
    from net n join public.profiles p on p.id = n.user_id
    for update of p
  ), upd as (
    update public.profiles p
    set balance = greatest(round(c.old_balance + c.amount, 4), 0)
    from calc c where p.id = c.user_id
    returning c.user_id, c.amount, c.played, (c.old_balance + c.amount < 0) as clamped
  ), notes as (
    insert into public.notifications (user_id, kind, payload)
    select u.user_id, 'MARKET_CANCELLED', jsonb_build_object('question', v_q, 'refunded', u.amount)
    from upd u where u.played
    returning 1
  )
  select count(*)::int, coalesce(sum(amount), 0), (count(*) filter (where clamped))::int
  into v_users, v_refunded, v_clamped from upd;

  delete from public.notifications where kind = 'HIDDEN_REWARD' and payload ->> 'market_id' = p_market_id::text;
  delete from public.markets where id = p_market_id;
  perform public._snapshot_networth(true);

  perform public.log_admin_action('delete_market', null, v_refunded,
    jsonb_build_object('market_id', p_market_id, 'question', v_q, 'users', v_users, 'clamped_users', v_clamped));
  return json_build_object('success', true, 'users', v_users, 'net_refunded', v_refunded, 'clamped_users', v_clamped);
end $$;
