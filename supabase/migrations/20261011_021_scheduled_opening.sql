-- Apertura programada: un mercado puede abrirse en una fecha y hora específicas.
--   · Por defecto (opens_at = null) se abre en el momento en que se crea.
--   · Con fecha futura: los jugadores lo ven como «Abre en…» pero NO pueden operar hasta esa hora (lo exige el servidor).
--   · Se puede reprogramar o abrir ya, mientras el mercado no tenga operaciones.
-- Además: una cuenta deshabilitada no puede comprar ni vender aunque su sesión siga abierta unos minutos.

alter table public.markets add column if not exists opens_at timestamptz;
alter table public.markets drop constraint if exists markets_open_before_close;
alter table public.markets add constraint markets_open_before_close check (opens_at is null or closes_at is null or opens_at < closes_at);

-- ---------------------------------------------------------------------
-- Creación (con apertura opcional)
-- ---------------------------------------------------------------------
drop function if exists public._create_market(text, text, text, timestamptz, text, text, text, uuid[], text, uuid, uuid, numeric);
create or replace function public._create_market(
  p_question text, p_description text, p_category text, p_closes_at timestamptz, p_image_url text,
  p_image_thumb_url text, p_image_color text, p_target_users uuid[], p_group_topic text, p_group_id uuid,
  p_created_by uuid, p_initial_price numeric default 0.5, p_opens_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg     public.game_settings;
  v_q     text := btrim(p_question);
  v_topic text := nullif(btrim(p_group_topic), '');
  v_desc  text := nullif(btrim(p_description), '');
  v_img   text := nullif(btrim(p_image_url), '');
  v_thumb text := nullif(btrim(p_image_thumb_url), '');
  v_color text := nullif(btrim(p_image_color), '');
  v_cat   text := coalesce(nullif(btrim(p_category), ''), 'otros');
  v_p     numeric := coalesce(p_initial_price, 0.5);
  v_open  timestamptz := p_opens_at;
  v_yes   numeric;
  v_no    numeric;
  v_id    uuid;
begin
  select * into cfg from public.game_settings limit 1;
  if v_q is null or char_length(v_q) < 3 or char_length(v_q) > 200 then
    raise exception 'La pregunta debe tener entre 3 y 200 caracteres';
  end if;
  if v_topic is not null and char_length(v_topic) > 120 then raise exception 'El tópico es demasiado largo'; end if;
  if v_desc is not null and char_length(v_desc) > 1000 then raise exception 'La descripción es demasiado larga'; end if;
  if v_cat not in ('deportes', 'familia', 'comida', 'viaje', 'juegos', 'clima', 'musica', 'otros') then
    raise exception 'Categoría inválida';
  end if;
  if p_closes_at is not null and p_closes_at <= now() + interval '30 seconds' then
    raise exception 'La fecha de cierre debe estar en el futuro';
  end if;
  -- una apertura en el pasado (o en los próximos segundos) significa «abrir ya»
  if v_open is not null and v_open <= now() + interval '30 seconds' then v_open := null; end if;
  if v_open is not null and p_closes_at is not null and v_open >= p_closes_at then
    raise exception 'La apertura debe ser antes del cierre';
  end if;
  if (v_img is not null and left(v_img, char_length(cfg.images_base_url)) <> cfg.images_base_url)
     or (v_thumb is not null and left(v_thumb, char_length(cfg.images_base_url)) <> cfg.images_base_url) then
    raise exception 'La imagen debe subirse desde la app';
  end if;
  if v_color is not null and v_color !~ '^#[0-9a-fA-F]{6}$' then v_color := null; end if;
  if v_p < 0.02 or v_p > 0.98 then raise exception 'Probabilidad inicial inválida'; end if;

  v_yes := round(cfg.initial_liquidity * sqrt((1 - v_p) / v_p), 8);
  v_no  := round(cfg.initial_liquidity * sqrt(v_p / (1 - v_p)), 8);

  insert into public.markets
    (question, description, image_url, image_thumb_url, image_color, yes_pool, no_pool, outcome, closed,
     group_topic, group_id, target_users, category, closes_at, opens_at, created_by)
  values
    (v_q, v_desc, v_img, v_thumb, v_color, v_yes, v_no, 'PENDING', false,
     v_topic, p_group_id,
     case when coalesce(array_length(p_target_users, 1), 0) > 0 then p_target_users else null end,
     v_cat, p_closes_at, v_open, p_created_by)
  returning id into v_id;

  insert into public.market_prices_history (market_id, yes_price, no_price, yes_pool, no_pool)
  values (v_id, v_no / (v_yes + v_no), v_yes / (v_yes + v_no), v_yes, v_no);
  return v_id;
end $$;
revoke all on function public._create_market(text, text, text, timestamptz, text, text, text, uuid[], text, uuid, uuid, numeric, timestamptz) from public, anon, authenticated;

drop function if exists public.staff_create_market(text, text, text, timestamptz, text, text, text, uuid[]);
create or replace function public.staff_create_market(
  p_question text, p_description text default null, p_category text default 'otros', p_closes_at timestamptz default null,
  p_image_url text default null, p_image_thumb_url text default null, p_image_color text default null,
  p_target_users uuid[] default null, p_opens_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Solo administradores o moderadores pueden crear mercados';
  end if;
  v_id := public._create_market(p_question, p_description, p_category, p_closes_at, p_image_url,
                                p_image_thumb_url, p_image_color, p_target_users, null, null, auth.uid(), 0.5, p_opens_at);
  perform public.log_admin_action('create_market', null, null, jsonb_build_object('market_id', v_id, 'question', btrim(p_question)));
  return v_id;
end $$;

drop function if exists public.staff_create_market_group(text, text[], text, text, timestamptz, text, text, text, uuid[]);
create or replace function public.staff_create_market_group(
  p_topic text, p_options text[], p_description text default null, p_category text default 'otros',
  p_closes_at timestamptz default null, p_image_url text default null, p_image_thumb_url text default null,
  p_image_color text default null, p_target_users uuid[] default null, p_opens_at timestamptz default null
) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_opt   text;
  v_ids   uuid[] := '{}';
  v_clean text[];
  v_group uuid := gen_random_uuid();
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Solo administradores o moderadores pueden crear mercados';
  end if;
  if nullif(btrim(p_topic), '') is null then raise exception 'El tópico general es requerido'; end if;
  select coalesce(array_agg(btrim(o)), '{}') into v_clean
  from unnest(p_options) o where nullif(btrim(o), '') is not null;
  if coalesce(array_length(v_clean, 1), 0) < 2 then raise exception 'Debes ingresar al menos 2 opciones'; end if;
  if coalesce(array_length(v_clean, 1), 0) > 30 then raise exception 'Máximo 30 opciones por mercado múltiple'; end if;

  foreach v_opt in array v_clean loop
    v_ids := v_ids || public._create_market(v_opt, p_description, p_category, p_closes_at, p_image_url,
                                            p_image_thumb_url, p_image_color, p_target_users, p_topic, v_group, auth.uid(),
                                            1.0 / array_length(v_clean, 1), p_opens_at);
  end loop;
  perform public.log_admin_action('create_market', null, null,
    jsonb_build_object('group_id', v_group, 'question', btrim(p_topic), 'options', array_length(v_clean, 1)));
  return json_build_object('created', array_length(v_ids, 1), 'ids', v_ids, 'group_id', v_group);
end $$;

drop function if exists public.staff_review_suggestion(uuid, text, text, text, text, text, timestamptz, text, text, text, uuid[]);
create or replace function public.staff_review_suggestion(
  p_id uuid, p_action text, p_reason text default null, p_question text default null, p_description text default null,
  p_category text default null, p_closes_at timestamptz default null, p_image_url text default null,
  p_image_thumb_url text default null, p_image_color text default null, p_target_users uuid[] default null,
  p_opens_at timestamptz default null
) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
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
                                              p_image_color, p_target_users, v_q, v_group, auth.uid(),
                                              1.0 / array_length(s.options, 1), p_opens_at);
    end loop;
  else
    v_ids := array[public._create_market(v_q, v_desc, v_cat, p_closes_at, p_image_url, p_image_thumb_url,
                                         p_image_color, p_target_users, null, null, auth.uid(), 0.5, p_opens_at)];
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

revoke all on function public.staff_create_market(text, text, text, timestamptz, text, text, text, uuid[], timestamptz) from public, anon;
revoke all on function public.staff_create_market_group(text, text[], text, text, timestamptz, text, text, text, uuid[], timestamptz) from public, anon;
revoke all on function public.staff_review_suggestion(uuid, text, text, text, text, text, timestamptz, text, text, text, uuid[], timestamptz) from public, anon;
grant execute on function public.staff_create_market(text, text, text, timestamptz, text, text, text, uuid[], timestamptz) to authenticated;
grant execute on function public.staff_create_market_group(text, text[], text, text, timestamptz, text, text, text, uuid[], timestamptz) to authenticated;
grant execute on function public.staff_review_suggestion(uuid, text, text, text, text, text, timestamptz, text, text, text, uuid[], timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- Edición: reprogramar o abrir ya (solo sin operaciones)
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
    raise exception 'Solo puedes editar o cerrar los mercados que tú creaste';
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
-- Precios ligeros: ahora incluyen la hora de apertura
-- ---------------------------------------------------------------------
drop function if exists public.get_market_prices();
create or replace function public.get_market_prices()
returns table(id uuid, yes_pool numeric, no_pool numeric, closed boolean, outcome text, closes_at timestamptz, opens_at timestamptz,
              static_rev integer, trades_24h integer, traders_24h integer, trades_total integer, score numeric, yes_price_24h numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  return query
  select m.id, m.yes_pool, m.no_pool, m.closed, m.outcome, m.closes_at, m.opens_at, m.static_rev,
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
revoke all on function public.get_market_prices() from public, anon;
grant execute on function public.get_market_prices() to authenticated;

-- ---------------------------------------------------------------------
-- Comprar y vender: no antes de la apertura, y no con la cuenta deshabilitada
-- ---------------------------------------------------------------------
create or replace function public.buy_shares(p_market_id uuid, p_side text, p_investment numeric, p_max_price numeric default null, p_request_id uuid default null)
returns json
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '6s' as $$
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
  perform public._assert_active();
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
  if v_market.opens_at is not null and clock_timestamp() < v_market.opens_at then
    raise exception 'Este mercado todavía no abre.';
  end if;
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

create or replace function public.sell_shares(p_market_id uuid, p_side text, p_shares_to_sell numeric, p_min_price numeric default null, p_request_id uuid default null)
returns json
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '6s' as $$
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
  perform public._assert_active();
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
  if v_market.opens_at is not null and clock_timestamp() < v_market.opens_at then
    raise exception 'Este mercado todavía no abre.';
  end if;
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

revoke all on function public.buy_shares(uuid, text, numeric, numeric, uuid) from public, anon;
revoke all on function public.sell_shares(uuid, text, numeric, numeric, uuid) from public, anon;
grant execute on function public.buy_shares(uuid, text, numeric, numeric, uuid) to authenticated;
grant execute on function public.sell_shares(uuid, text, numeric, numeric, uuid) to authenticated;
