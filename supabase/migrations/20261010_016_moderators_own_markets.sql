-- Los moderadores solo pueden cerrar, editar y resolver los mercados que ELLOS crearon.
-- El dueño sigue pudiendo con todos. Crear mercados y revisar sugerencias no cambia (lo que un moderador aprueba o crea
-- queda a su nombre, así que puede manejarlo).
--
-- «Cerrar» incluye resolver: resolver también cierra el mercado, así que la misma regla aplica a resolve_market.
-- Un mercado de varias opciones se crea completo con el mismo autor, así que la regla vale para todo el grupo.

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

  update public.markets set closed = true, outcome = p_outcome, resolved_at = now() where id = p_market_id;
  perform public._snapshot_networth(true);

  perform public.log_admin_action('resolve_market', null, v_total,
    jsonb_build_object('market_id', p_market_id, 'question', v_market.question, 'outcome', p_outcome, 'winners', v_winners));

  return json_build_object('success', true, 'outcome', p_outcome, 'total_paid', v_total,
                           'winners', v_winners, 'notified', v_notified);
end $$;

create or replace function public.staff_update_market(p_market_id uuid, p_patch jsonb, p_apply_group boolean default true)
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg     public.game_settings;
  m       public.markets;
  v_cat   text;
  v_close timestamptz;
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
