-- Corrección de la 018: el proyecto tiene activado pg_safeupdate, que rechaza UPDATE sin WHERE
-- («UPDATE requires a WHERE clause»). Las funciones que cambian la fila única de signup_config ahora llevan WHERE.
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
