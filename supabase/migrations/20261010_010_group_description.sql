-- =====================================================================
-- 010 · Editar la descripcion de un mercado multiple la cambia en TODAS sus opciones
--       (antes solo cambiaba la de la opcion editada y las demas quedaban distintas)
-- =====================================================================
create or replace function public.staff_update_market(p_market_id uuid, p_patch jsonb, p_apply_group boolean default true)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  -- Campos compartidos: este mercado o todo su grupo
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

revoke all on function public.staff_update_market(uuid, jsonb, boolean) from public, anon;
grant execute on function public.staff_update_market(uuid, jsonb, boolean) to authenticated;
