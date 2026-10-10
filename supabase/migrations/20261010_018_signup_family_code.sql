-- Registro sencillo para toda la familia: link + «código de la familia» + nombre + contraseña. Sin correos y sin Google.
--
-- · Una persona nueva abre el link, escribe el código (o ya viene en el link), elige su nombre de jugador y una contraseña. Entra de una.
-- · La cuenta se crea con un correo interno inventado (nombre@jugador.familymarket.invalid): no se manda ningún correo y nada puede
--   caer en spam. Quien se registró antes con su correo sigue entrando con él.
-- · La compuerta está en la base de datos (disparador sobre auth.users): sin el código correcto no se crea ningún usuario.
-- · El dueño puede cambiar el código, cerrar el registro y poner un máximo de jugadores (Admin → Gente → «Registro de jugadores»).
-- · Si alguien olvida su contraseña, el dueño se la restablece (Admin → Gente → Contraseña).
-- La vía anterior (correos invitados / Google) sigue funcionando para quien el dueño invite por correo.

create table if not exists public.signup_config (
  id          boolean primary key default true check (id),
  code        text not null,
  is_open     boolean not null default true,
  max_players int not null default 60 check (max_players between 1 and 500),
  updated_at  timestamptz not null default now()
);
alter table public.signup_config enable row level security;
revoke all on table public.signup_config from public, anon, authenticated;

create table if not exists public.signup_attempts (
  id bigint generated always as identity primary key,
  at timestamptz not null default now()
);
alter table public.signup_attempts enable row level security;
create index if not exists signup_attempts_at_idx on public.signup_attempts (at);
revoke all on table public.signup_attempts from public, anon, authenticated;

-- Código aleatorio de 8 caracteres sin letras que se confunden (sin 0, O, 1, I, L): ~850 mil millones de combinaciones.
create or replace function public._new_signup_code()
returns text language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b   bytea := extensions.gen_random_bytes(8);
  out text := '';
  i   int;
begin
  for i in 0..7 loop
    out := out || substr(alphabet, (get_byte(b, i) % 31) + 1, 1);
  end loop;
  return out;
end $$;
revoke all on function public._new_signup_code() from public, anon, authenticated;

create or replace function public.norm_code(p text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;
revoke all on function public.norm_code(text) from public, anon, authenticated;

insert into public.signup_config (id, code) values (true, public._new_signup_code()) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Compuerta de registro (reemplaza a la de la migración 015, que conserva las invitaciones por correo)
-- ---------------------------------------------------------------------
create or replace function public.enforce_invite()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key      text := public.norm_email(coalesce(new.email, ''));
  v_provider text := coalesce(new.raw_app_meta_data ->> 'provider', 'email');
  v_pw       boolean;
  v_code     text := public.norm_code(new.raw_user_meta_data ->> 'family_code');
  v_user     text := btrim(coalesce(new.raw_user_meta_data ->> 'username', ''));
  cfg        public.signup_config;
begin
  -- 1) Correo invitado por el dueño (Google, o contraseña si se marcó)
  select password_ok into v_pw from public.invited_emails where email_key = v_key;
  if v_key <> '' and found then
    if v_provider = 'email' and not v_pw then
      raise exception 'PASSWORD_NOT_ALLOWED: este correo debe entrar con Google';
    end if;
    if exists (select 1 from auth.users u where u.id <> new.id and public.norm_email(u.email) = v_key) then
      raise exception 'EMAIL_DUPLICATE: ya existe una cuenta con este correo';
    end if;
    return new;
  end if;

  -- 2) Registro por «código de la familia»
  if v_provider = 'email' and v_code <> '' then
    select * into cfg from public.signup_config limit 1;
    if not cfg.is_open then raise exception 'SIGNUP_CLOSED: el registro está cerrado'; end if;
    if v_code <> public.norm_code(cfg.code) then raise exception 'BAD_CODE: código incorrecto'; end if;
    if (select count(*) from public.profiles) >= cfg.max_players then raise exception 'SIGNUP_FULL: ya no hay cupo'; end if;
    if v_user !~ '^[A-Za-z0-9_]{3,20}$' then raise exception 'USERNAME_INVALID: nombre no válido'; end if;
    if exists (select 1 from public.profiles where lower(username) = lower(v_user)) then
      raise exception 'USERNAME_TAKEN: ese nombre ya está en uso';
    end if;
    if new.email is distinct from lower(v_user) || '@jugador.familymarket.invalid' then
      raise exception 'BAD_EMAIL: correo interno no válido';
    end if;
    return new;
  end if;

  raise exception 'EMAIL_NOT_INVITED: este correo no está en la lista de la familia';
end $$;
revoke all on function public.enforce_invite() from public, anon, authenticated;

-- El perfil nace con el nombre ya elegido cuando el registro fue por código.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, balance, is_admin, username)
  values (new.id, new.email, (select initial_balance from public.game_settings limit 1), false,
          case when new.raw_user_meta_data ? 'family_code' then btrim(new.raw_user_meta_data ->> 'username') else null end)
  on conflict (id) do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Funciones públicas (las usa la pantalla de registro ANTES de tener cuenta)
-- ---------------------------------------------------------------------
create or replace function public.signup_status()
returns json language sql stable security definer set search_path = public, pg_temp as $$
  select json_build_object(
    'open', c.is_open,
    'full', (select count(*) from public.profiles) >= c.max_players
  ) from public.signup_config c limit 1
$$;

create or replace function public.username_available(p_username text)
returns json language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v text := btrim(coalesce(p_username, ''));
begin
  if v !~ '^[A-Za-z0-9_]{3,20}$' then return json_build_object('valid', false, 'available', false); end if;
  return json_build_object('valid', true, 'available', not exists (select 1 from public.profiles where lower(username) = lower(v)));
end $$;

-- Comprueba el código (y el nombre) para dar un mensaje claro. Limita los intentos fallidos: más de 200 en 10 minutos bloquea el registro un rato.
create or replace function public.check_signup_code(p_code text, p_username text default null)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg    public.signup_config;
  v_name text := btrim(coalesce(p_username, ''));
begin
  select * into cfg from public.signup_config limit 1;
  if not cfg.is_open then return json_build_object('ok', false, 'reason', 'closed'); end if;
  if (select count(*) from public.signup_attempts where at > now() - interval '10 minutes') >= 200 then
    return json_build_object('ok', false, 'reason', 'locked');
  end if;
  if public.norm_code(p_code) = '' or public.norm_code(p_code) <> public.norm_code(cfg.code) then
    insert into public.signup_attempts default values;
    delete from public.signup_attempts where at < now() - interval '1 day';
    return json_build_object('ok', false, 'reason', 'bad_code');
  end if;
  if (select count(*) from public.profiles) >= cfg.max_players then return json_build_object('ok', false, 'reason', 'full'); end if;
  if v_name <> '' then
    if v_name !~ '^[A-Za-z0-9_]{3,20}$' then return json_build_object('ok', false, 'reason', 'username_invalid'); end if;
    if exists (select 1 from public.profiles where lower(username) = lower(v_name)) then
      return json_build_object('ok', false, 'reason', 'username_taken');
    end if;
  end if;
  return json_build_object('ok', true);
end $$;

revoke all on function public.signup_status() from public;
revoke all on function public.username_available(text) from public;
revoke all on function public.check_signup_code(text, text) from public;
grant execute on function public.signup_status() to anon, authenticated;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.check_signup_code(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Gestión (solo el dueño)
-- ---------------------------------------------------------------------
create or replace function public.admin_get_signup()
returns json language plpgsql stable security definer set search_path = public, pg_temp as $$
declare cfg public.signup_config;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño puede ver el registro'; end if;
  select * into cfg from public.signup_config limit 1;
  return json_build_object('code', cfg.code, 'is_open', cfg.is_open, 'max_players', cfg.max_players,
                           'players', (select count(*) from public.profiles));
end $$;

create or replace function public.admin_set_signup(p_open boolean, p_max int default null)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño puede cambiar el registro'; end if;
  if p_max is not null and p_max not between 1 and 500 then raise exception 'El máximo debe estar entre 1 y 500'; end if;
  update public.signup_config
  set is_open = coalesce(p_open, is_open), max_players = coalesce(p_max, max_players), updated_at = now()
  where id;
  perform public.log_admin_action('set_signup', null, null, jsonb_build_object('open', p_open, 'max', p_max));
  return public.admin_get_signup();
end $$;

create or replace function public.admin_rotate_signup_code()
returns json language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño puede cambiar el código'; end if;
  update public.signup_config set code = public._new_signup_code(), updated_at = now() where id;
  perform public.log_admin_action('rotate_signup_code', null, null, null);
  return public.admin_get_signup();
end $$;

revoke all on function public.admin_get_signup() from public, anon;
revoke all on function public.admin_set_signup(boolean, int) from public, anon;
revoke all on function public.admin_rotate_signup_code() from public, anon;
grant execute on function public.admin_get_signup() to authenticated;
grant execute on function public.admin_set_signup(boolean, int) to authenticated;
grant execute on function public.admin_rotate_signup_code() to authenticated;
