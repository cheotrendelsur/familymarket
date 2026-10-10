-- Las marcas de tiempo ahora siguen el ORDEN REAL de ejecución.
--
-- now() es la hora en que EMPEZÓ la transacción, no la hora en que obtuvo el candado del mercado. Si una compra empezaba
-- unos milisegundos antes que una resolución pero conseguía el candado después... (o al revés) quedaba con una hora
-- anterior/posterior a la real: una operación válida aparecía «después» de la resolución, o dos operaciones del mismo
-- mercado aparecían en el historial en orden cambiado. El dinero siempre fue correcto (todo se serializa por el candado
-- del mercado); era solo la hora que se guardaba.
--
-- clock_timestamp() se evalúa en el momento de insertar la fila, que ocurre DESPUÉS de tomar los candados.
alter table public.transactions alter column created_at set default clock_timestamp();
alter table public.transaction_logs alter column created_at set default clock_timestamp();
alter table public.market_prices_history alter column created_at set default clock_timestamp();

-- resolve_market: resolved_at = hora real de la resolución (con el candado ya tomado).
create or replace function public.resolve_market(p_market_id uuid, p_outcome text)
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
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

  update public.markets set closed = true, outcome = p_outcome, resolved_at = clock_timestamp() where id = p_market_id;
  perform public._snapshot_networth(true);

  perform public.log_admin_action('resolve_market', null, v_total,
    jsonb_build_object('market_id', p_market_id, 'question', v_market.question, 'outcome', p_outcome, 'winners', v_winners));

  return json_build_object('success', true, 'outcome', p_outcome, 'total_paid', v_total,
                           'winners', v_winners, 'notified', v_notified);
end $$;
