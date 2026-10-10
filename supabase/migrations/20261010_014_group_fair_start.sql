-- Mercados de varias opciones: arranque justo (1/N por opción) en vez de 50 % para todas.
--
-- PROBLEMA: en un mercado múltiple solo puede ganar UNA opción (o ninguna), pero cada opción nacía con 50 % de «Sí».
-- Con N >= 3 opciones la suma de precios de «Sí» era N/2 > 100 %, y comprar «No» en TODAS las opciones era una ganancia
-- segura (cuesta ~N/2 y paga al menos N-1): dinero gratis para quien lo notara primero, pagado por la liquidez inicial.
--
-- ARREGLO: cada opción nace con probabilidad 1/N (suma = 100 %). Se conserva k = L² (mismo costo de mover el precio y el
-- mismo regalo máximo por opción). Con N = 2 queda exactamente igual que antes (50 / 50).
--   yes_pool = L * sqrt((1 - p) / p)      no_pool = L * sqrt(p / (1 - p))      => precio(Sí) = no / (yes + no) = p

drop function if exists public._create_market(text, text, text, timestamptz, text, text, text, uuid[], text, uuid, uuid);

create or replace function public._create_market(
  p_question text, p_description text, p_category text, p_closes_at timestamptz, p_image_url text,
  p_image_thumb_url text, p_image_color text, p_target_users uuid[], p_group_topic text, p_group_id uuid,
  p_created_by uuid, p_initial_price numeric default 0.5
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
     group_topic, group_id, target_users, category, closes_at, created_by)
  values
    (v_q, v_desc, v_img, v_thumb, v_color, v_yes, v_no, 'PENDING', false,
     v_topic, p_group_id,
     case when coalesce(array_length(p_target_users, 1), 0) > 0 then p_target_users else null end,
     v_cat, p_closes_at, p_created_by)
  returning id into v_id;

  insert into public.market_prices_history (market_id, yes_price, no_price, yes_pool, no_pool)
  values (v_id, v_no / (v_yes + v_no), v_yes / (v_yes + v_no), v_yes, v_no);
  return v_id;
end $$;
revoke all on function public._create_market(text, text, text, timestamptz, text, text, text, uuid[], text, uuid, uuid, numeric) from public, anon, authenticated;

create or replace function public.staff_create_market_group(
  p_topic text, p_options text[], p_description text default null, p_category text default 'otros',
  p_closes_at timestamptz default null, p_image_url text default null, p_image_thumb_url text default null,
  p_image_color text default null, p_target_users uuid[] default null
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
                                            1.0 / array_length(v_clean, 1));
  end loop;
  perform public.log_admin_action('create_market', null, null,
    jsonb_build_object('group_id', v_group, 'question', btrim(p_topic), 'options', array_length(v_clean, 1)));
  return json_build_object('created', array_length(v_ids, 1), 'ids', v_ids, 'group_id', v_group);
end $$;

create or replace function public.staff_review_suggestion(
  p_id uuid, p_action text, p_reason text default null, p_question text default null, p_description text default null,
  p_category text default null, p_closes_at timestamptz default null, p_image_url text default null,
  p_image_thumb_url text default null, p_image_color text default null, p_target_users uuid[] default null
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
                                              1.0 / array_length(s.options, 1));
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
