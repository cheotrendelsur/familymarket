-- =====================================================================
-- 006 · ROLES (dueño / moderadores) + METADATOS DE MERCADO + GESTION DE JUGADORES
-- =====================================================================
-- Dueño      = profiles.is_admin = true  (todo)
-- Moderador  = profiles.is_moderator     (crear/resolver mercados, sugerencias, registro de actividad)
-- Jugador    = el resto
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists is_moderator boolean not null default false;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select is_admin or is_moderator from public.profiles where id = auth.uid()), false)
$$;
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Metadatos de mercado
-- ---------------------------------------------------------------------
alter table public.game_settings
  add column if not exists images_base_url text not null
  default 'https://tbxwqxuandxibpwoshuc.supabase.co/storage/v1/object/public/market-images/';

alter table public.markets
  add column if not exists category        text not null default 'otros',
  add column if not exists closes_at       timestamptz,
  add column if not exists group_id        uuid,
  add column if not exists image_thumb_url text,
  add column if not exists image_color     text,
  add column if not exists created_by      uuid references public.profiles(id) on delete set null,
  add column if not exists static_rev      int not null default 0;

alter table public.markets drop constraint if exists markets_category_check;
alter table public.markets add constraint markets_category_check
  check (category in ('deportes', 'familia', 'comida', 'viaje', 'juegos', 'clima', 'musica', 'otros'));
alter table public.markets drop constraint if exists markets_image_color_check;
alter table public.markets add constraint markets_image_color_check
  check (image_color is null or image_color ~ '^#[0-9a-fA-F]{6}$');

create index if not exists markets_group_idx on public.markets (group_id) where group_id is not null;
create index if not exists markets_closes_idx on public.markets (closes_at) where closed = false and closes_at is not null;

-- Revision "estatica": cambia solo cuando cambia texto/imagen/categoria/cierre/grupo/visibilidad
-- (NO con cada compra). Permite sondear solo precios y descargar el resto cuando hace falta.
create or replace function public._bump_market_static_rev()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (new.question, new.description, new.image_url, new.image_thumb_url, new.image_color,
      new.category, new.closes_at, new.group_id, new.group_topic, new.target_users)
     is distinct from
     (old.question, old.description, old.image_url, old.image_thumb_url, old.image_color,
      old.category, old.closes_at, old.group_id, old.group_topic, old.target_users) then
    new.static_rev := old.static_rev + 1;
  end if;
  return new;
end $$;
drop trigger if exists markets_static_rev on public.markets;
create trigger markets_static_rev before update on public.markets
  for each row execute function public._bump_market_static_rev();

-- ---------------------------------------------------------------------
-- 3. Visibilidad ("filtro fantasma"): dueño ve todo, el creador ve lo suyo
-- ---------------------------------------------------------------------
create or replace function public.can_see_market(p_target uuid[], p_created_by uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select public.is_admin()
      or (p_created_by is not null and p_created_by = auth.uid())
      or coalesce(array_length(p_target, 1), 0) = 0
      or not (auth.uid() = any (p_target))
$$;
revoke all on function public.can_see_market(uuid[], uuid) from public, anon;
grant execute on function public.can_see_market(uuid[], uuid) to authenticated;

drop policy if exists markets_select on public.markets;
create policy markets_select on public.markets for select to authenticated
  using (public.can_see_market(target_users, created_by));

-- ---------------------------------------------------------------------
-- 4. Creacion de mercados (dueño y moderadores)
-- ---------------------------------------------------------------------
create or replace function public._create_market(
  p_question text, p_description text, p_category text, p_closes_at timestamptz,
  p_image_url text, p_image_thumb_url text, p_image_color text,
  p_target_users uuid[], p_group_topic text, p_group_id uuid, p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg     public.game_settings;
  v_q     text := btrim(p_question);
  v_topic text := nullif(btrim(p_group_topic), '');
  v_desc  text := nullif(btrim(p_description), '');
  v_img   text := nullif(btrim(p_image_url), '');
  v_thumb text := nullif(btrim(p_image_thumb_url), '');
  v_color text := nullif(btrim(p_image_color), '');
  v_cat   text := coalesce(nullif(btrim(p_category), ''), 'otros');
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

  insert into public.markets
    (question, description, image_url, image_thumb_url, image_color, yes_pool, no_pool, outcome, closed,
     group_topic, group_id, target_users, category, closes_at, created_by)
  values
    (v_q, v_desc, v_img, v_thumb, v_color, cfg.initial_liquidity, cfg.initial_liquidity, 'PENDING', false,
     v_topic, p_group_id,
     case when coalesce(array_length(p_target_users, 1), 0) > 0 then p_target_users else null end,
     v_cat, p_closes_at, p_created_by)
  returning id into v_id;

  insert into public.market_prices_history (market_id, yes_price, no_price, yes_pool, no_pool)
  values (v_id, 0.5, 0.5, cfg.initial_liquidity, cfg.initial_liquidity);
  return v_id;
end $$;
revoke all on function public._create_market(text, text, text, timestamptz, text, text, text, uuid[], text, uuid, uuid) from public, anon, authenticated;

drop function if exists public.admin_create_market(text, text, text, text, uuid[]);
drop function if exists public.admin_create_market_group(text, text[], text, text, uuid[]);

create or replace function public.staff_create_market(
  p_question         text,
  p_description      text        default null,
  p_category         text        default 'otros',
  p_closes_at        timestamptz default null,
  p_image_url        text        default null,
  p_image_thumb_url  text        default null,
  p_image_color      text        default null,
  p_target_users     uuid[]      default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Solo administradores o moderadores pueden crear mercados';
  end if;
  v_id := public._create_market(p_question, p_description, p_category, p_closes_at, p_image_url,
                                p_image_thumb_url, p_image_color, p_target_users, null, null, auth.uid());
  perform public.log_admin_action('create_market', null, null, jsonb_build_object('market_id', v_id, 'question', btrim(p_question)));
  return v_id;
end $$;

create or replace function public.staff_create_market_group(
  p_topic            text,
  p_options          text[],
  p_description      text        default null,
  p_category         text        default 'otros',
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
                                            p_image_thumb_url, p_image_color, p_target_users, p_topic, v_group, auth.uid());
  end loop;
  perform public.log_admin_action('create_market', null, null,
    jsonb_build_object('group_id', v_group, 'question', btrim(p_topic), 'options', array_length(v_clean, 1)));
  return json_build_object('created', array_length(v_ids, 1), 'ids', v_ids, 'group_id', v_group);
end $$;

-- ---------------------------------------------------------------------
-- 5. Edicion de un mercado: parche JSON (solo se aplican las claves presentes; null = borrar)
--    claves: question, description, category, closes_at, image_url, image_thumb_url, image_color, group_topic
--    p_apply_group: category/closes_at/imagen/group_topic se aplican a todo el grupo
-- ---------------------------------------------------------------------
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
    update public.markets set description = nullif(btrim(p_patch->>'description'), '') where id = p_market_id;
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
    jsonb_build_object('market_id', p_market_id, 'keys', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p_patch) k)));
  return json_build_object('success', true, 'updated', v_n);
end $$;

-- ---------------------------------------------------------------------
-- 6. Jugadores: listados y herramientas del dueño
-- ---------------------------------------------------------------------
create or replace function public.staff_list_players()
returns table (id uuid, username text, is_moderator boolean, is_admin boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Solo administradores o moderadores'; end if;
  return query
  select p.id, p.username, p.is_moderator, p.is_admin
  from public.profiles p where p.username is not null order by lower(p.username);
end $$;

drop function if exists public.admin_list_players();
create or replace function public.admin_list_players()
returns table (id uuid, username text, balance numeric, is_admin boolean, is_moderator boolean, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño'; end if;
  return query
  select p.id, p.username, p.balance, p.is_admin, p.is_moderator, p.created_at
  from public.profiles p order by lower(p.username) nulls last;
end $$;

create or replace function public.admin_set_moderator(p_user_id uuid, p_value boolean)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_name text; v_owner boolean;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño puede nombrar moderadores'; end if;
  select username, is_admin into v_name, v_owner from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Jugador no encontrado'; end if;
  if v_owner then raise exception 'El dueño ya tiene todos los permisos'; end if;
  update public.profiles set is_moderator = coalesce(p_value, false) where id = p_user_id;
  perform public.log_admin_action(case when p_value then 'moderator_on' else 'moderator_off' end, p_user_id, null,
                                  jsonb_build_object('username', v_name));
  return json_build_object('success', true, 'is_moderator', coalesce(p_value, false));
end $$;

create or replace function public.admin_rename_player(p_user_id uuid, p_username text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_name text := btrim(p_username); v_old text;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño puede renombrar jugadores'; end if;
  if v_name is null or v_name !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'Usa de 3 a 20 caracteres: letras, números o guion bajo';
  end if;
  if exists (select 1 from public.profiles where lower(username) = lower(v_name) and id <> p_user_id) then
    raise exception 'Ese nombre ya está en uso';
  end if;
  select username into v_old from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Jugador no encontrado'; end if;
  update public.profiles set username = v_name where id = p_user_id;
  perform public.log_admin_action('rename_player', p_user_id, null, jsonb_build_object('from', v_old, 'to', v_name));
  return json_build_object('success', true, 'username', v_name);
end $$;

-- Restablecer contraseña (sin correo): el dueño define una nueva y se cierran las sesiones del jugador
create or replace function public.admin_reset_password(p_user_id uuid, p_new_password text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_name text;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño puede restablecer contraseñas'; end if;
  if p_new_password is null or char_length(p_new_password) < 6 or char_length(p_new_password) > 72 then
    raise exception 'La contraseña debe tener entre 6 y 72 caracteres';
  end if;
  select username into v_name from public.profiles where id = p_user_id;
  if not found then raise exception 'Jugador no encontrado'; end if;
  update auth.users
  set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      updated_at = now()
  where id = p_user_id;
  delete from auth.sessions where user_id = p_user_id;
  perform public.log_admin_action('reset_password', p_user_id, null, jsonb_build_object('username', v_name));
  return json_build_object('success', true);
end $$;

-- El registro de actividad lo ven dueño y moderadores
create or replace function public.admin_recent_actions(p_limit int default 30)
returns table (id bigint, created_at timestamptz, action text, admin_username text,
               target_username text, amount numeric, detail jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Solo administradores o moderadores'; end if;
  return query
  select a.id, a.created_at, a.action, pa.username, pt.username, a.amount, a.detail
  from public.admin_actions a
  left join public.profiles pa on pa.id = a.admin_id
  left join public.profiles pt on pt.id = a.target_user
  order by a.id desc
  limit least(greatest(p_limit, 1), 200);
end $$;

-- ---------------------------------------------------------------------
-- 7. Permisos
-- ---------------------------------------------------------------------
revoke all on function public.staff_create_market(text, text, text, timestamptz, text, text, text, uuid[]) from public, anon;
revoke all on function public.staff_create_market_group(text, text[], text, text, timestamptz, text, text, text, uuid[]) from public, anon;
revoke all on function public.staff_update_market(uuid, jsonb, boolean) from public, anon;
revoke all on function public.staff_list_players() from public, anon;
revoke all on function public.admin_list_players() from public, anon;
revoke all on function public.admin_set_moderator(uuid, boolean) from public, anon;
revoke all on function public.admin_rename_player(uuid, text) from public, anon;
revoke all on function public.admin_reset_password(uuid, text) from public, anon;
revoke all on function public.admin_recent_actions(int) from public, anon;
grant execute on function public.staff_create_market(text, text, text, timestamptz, text, text, text, uuid[]) to authenticated;
grant execute on function public.staff_create_market_group(text, text[], text, text, timestamptz, text, text, text, uuid[]) to authenticated;
grant execute on function public.staff_update_market(uuid, jsonb, boolean) to authenticated;
grant execute on function public.staff_list_players() to authenticated;
grant execute on function public.admin_list_players() to authenticated;
grant execute on function public.admin_set_moderator(uuid, boolean) to authenticated;
grant execute on function public.admin_rename_player(uuid, text) to authenticated;
grant execute on function public.admin_reset_password(uuid, text) to authenticated;
grant execute on function public.admin_recent_actions(int) to authenticated;
