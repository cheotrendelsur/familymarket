-- Lista de invitados: solo pueden crear cuenta las personas cuyo correo el dueño agregó.
--
-- · Entrar con Google (gratis, sin correos de confirmación): el correo lo verifica Google, así que nadie puede
--   «robar» un lugar con el correo de otra persona. Es la vía normal.
-- · Correo + contraseña: SOLO para invitados marcados «con contraseña» (alguien sin cuenta de Google). Los 9 jugadores
--   que ya existían quedan invitados con contraseña, así que siguen entrando como siempre.
-- · Todo lo demás se rechaza en la base de datos ANTES de crear el usuario: un desconocido no llega a tener sesión.
--
-- Gmail ignora los puntos y lo que va después de «+» (juan.perez@gmail.com = juanperez@gmail.com): se comparan normalizados
-- para que una persona no tenga dos cuentas por escribir su correo distinto.

create or replace function public.norm_email(p text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
           when split_part(lower(btrim(p)), '@', 2) in ('gmail.com', 'googlemail.com')
             then replace(split_part(split_part(lower(btrim(p)), '@', 1), '+', 1), '.', '') || '@gmail.com'
           else lower(btrim(p))
         end
$$;

create table if not exists public.invited_emails (
  email_key   text primary key,
  email       text not null,
  password_ok boolean not null default false,
  note        text,
  invited_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.invited_emails enable row level security;
revoke all on table public.invited_emails from public, anon, authenticated;

-- Los jugadores que ya existen quedan invitados (con contraseña, porque así entran hoy).
insert into public.invited_emails (email_key, email, password_ok, note)
select public.norm_email(u.email), lower(u.email), true, 'jugador existente'
from auth.users u
where u.email is not null and u.email not like '%@loadtest.invalid'
on conflict (email_key) do nothing;

-- ---------------------------------------------------------------------
-- Compuerta: se ejecuta antes de crear cualquier usuario (Google, contraseña, API admin).
-- ---------------------------------------------------------------------
create or replace function public.enforce_invite()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key      text := public.norm_email(coalesce(new.email, ''));
  v_provider text := coalesce(new.raw_app_meta_data ->> 'provider', 'email');
  v_pw       boolean;
begin
  select password_ok into v_pw from public.invited_emails where email_key = v_key;
  if v_key = '' or not found then
    raise exception 'EMAIL_NOT_INVITED: este correo no está en la lista de la familia';
  end if;
  if v_provider = 'email' and not v_pw then
    raise exception 'PASSWORD_NOT_ALLOWED: este correo debe entrar con Google';
  end if;
  if exists (select 1 from auth.users u where u.id <> new.id and public.norm_email(u.email) = v_key) then
    raise exception 'EMAIL_DUPLICATE: ya existe una cuenta con este correo';
  end if;
  return new;
end $$;
revoke all on function public.enforce_invite() from public, anon, authenticated;

drop trigger if exists enforce_invite on auth.users;
create trigger enforce_invite before insert on auth.users for each row execute function public.enforce_invite();

-- ---------------------------------------------------------------------
-- Gestión (solo el dueño)
-- ---------------------------------------------------------------------
create or replace function public.admin_list_invites()
returns json language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño puede ver las invitaciones'; end if;
  return coalesce((
    select json_agg(x order by x.joined, x.created_at desc)
    from (
      select i.email, i.password_ok, i.note, i.created_at,
             (select p.username from auth.users u join public.profiles p on p.id = u.id
               where public.norm_email(u.email) = i.email_key limit 1) as username,
             exists (select 1 from auth.users u where public.norm_email(u.email) = i.email_key) as joined
      from public.invited_emails i
    ) x
  ), '[]'::json);
end $$;

create or replace function public.admin_invite_emails(p_emails text[], p_password_ok boolean default false)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_raw     text;
  v_email   text;
  v_key     text;
  v_added   int := 0;
  v_already int := 0;
  v_invalid text[] := '{}';
  v_total   int;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño puede invitar jugadores'; end if;
  if p_emails is null or coalesce(array_length(p_emails, 1), 0) = 0 then raise exception 'Escribe al menos un correo'; end if;
  if array_length(p_emails, 1) > 100 then raise exception 'Máximo 100 correos por vez'; end if;

  foreach v_raw in array p_emails loop
    v_email := lower(btrim(coalesce(v_raw, '')));
    if v_email = '' then continue; end if;
    if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      v_invalid := v_invalid || v_email;
      continue;
    end if;
    v_key := public.norm_email(v_email);
    insert into public.invited_emails (email_key, email, password_ok, invited_by)
    values (v_key, v_email, coalesce(p_password_ok, false), auth.uid())
    on conflict (email_key) do update
      set password_ok = public.invited_emails.password_ok or excluded.password_ok
      where excluded.password_ok and not public.invited_emails.password_ok;
    if found then v_added := v_added + 1; else v_already := v_already + 1; end if;
  end loop;

  select count(*) into v_total from public.invited_emails;
  if v_total > 300 then raise exception 'Demasiadas invitaciones (máximo 300)'; end if;

  perform public.log_admin_action('invite_emails', null, null,
    jsonb_build_object('added', v_added, 'already', v_already, 'invalid', coalesce(array_length(v_invalid, 1), 0)));
  return json_build_object('added', v_added, 'already', v_already, 'invalid', v_invalid);
end $$;

create or replace function public.admin_set_invite_password(p_email text, p_value boolean)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño puede cambiar invitaciones'; end if;
  update public.invited_emails set password_ok = coalesce(p_value, false) where email_key = public.norm_email(p_email);
  if not found then raise exception 'Esa invitación no existe'; end if;
  return json_build_object('success', true);
end $$;

create or replace function public.admin_remove_invite(p_email text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_key text := public.norm_email(p_email);
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño puede quitar invitaciones'; end if;
  if exists (select 1 from auth.users u where public.norm_email(u.email) = v_key) then
    raise exception 'Esa persona ya tiene cuenta; quitarle la invitación no la saca del juego';
  end if;
  delete from public.invited_emails where email_key = v_key;
  if not found then raise exception 'Esa invitación no existe'; end if;
  perform public.log_admin_action('remove_invite', null, null, jsonb_build_object('email', lower(btrim(p_email))));
  return json_build_object('success', true);
end $$;

revoke all on function public.admin_list_invites() from public, anon;
revoke all on function public.admin_invite_emails(text[], boolean) from public, anon;
revoke all on function public.admin_set_invite_password(text, boolean) from public, anon;
revoke all on function public.admin_remove_invite(text) from public, anon;
grant execute on function public.admin_list_invites() to authenticated;
grant execute on function public.admin_invite_emails(text[], boolean) to authenticated;
grant execute on function public.admin_set_invite_password(text, boolean) to authenticated;
grant execute on function public.admin_remove_invite(text) to authenticated;
revoke all on function public.norm_email(text) from public, anon, authenticated;
