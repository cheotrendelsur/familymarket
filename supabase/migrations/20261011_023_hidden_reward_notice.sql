-- 023 · El aviso del premio por mercado sorpresa ahora muestra la apuesta que se les ocultó
--
-- Al resolverse el mercado, quien no pudo participar recibe el aviso con animación. Ahora el aviso trae la pregunta del
-- mercado, el resultado, el dinero que se movió y cuántas personas se repartieron la bolsa, para que sepa de qué apuesta
-- viene el premio (antes solo decía «hubo un mercado sorpresa»). Solo cambia el contenido del aviso: el cálculo y el
-- pago son los mismos de la migración 022.

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
