-- =====================================================================
-- 005 · SUPERFICIE DE ATAQUE MINIMA + KEEP-ALIVE + AUDITORIA
-- =====================================================================

-- El archivo "Recuerdos" solo se lee por RPC: ningun rol de la API toca sus tablas
-- (tampoco deben verse en el esquema GraphQL).
revoke all on all tables in schema archive from public, anon, authenticated;
revoke all on all sequences in schema archive from public, anon, authenticated;
alter default privileges in schema archive revoke all on tables from public, anon, authenticated;
revoke all on schema archive from public, anon, authenticated;

-- La auditoria de admin se consulta por RPC (no por la tabla).
drop policy if exists admin_actions_select on public.admin_actions;
revoke select on public.admin_actions from authenticated;

create or replace function public.admin_recent_actions(p_limit int default 30)
returns table (id bigint, created_at timestamptz, action text, admin_username text,
               target_username text, amount numeric, detail jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Solo administradores';
  end if;
  return query
  select a.id, a.created_at, a.action, pa.username, pt.username, a.amount, a.detail
  from public.admin_actions a
  left join public.profiles pa on pa.id = a.admin_id
  left join public.profiles pt on pt.id = a.target_user
  order by a.id desc
  limit least(greatest(p_limit, 1), 200);
end $$;
revoke all on function public.admin_recent_actions(int) from public, anon;
grant execute on function public.admin_recent_actions(int) to authenticated;

-- Latido minimo para evitar que Supabase pause el proyecto gratuito por inactividad
-- (lo invoca un cron gratuito de GitHub Actions; no expone ningun dato).
create or replace function public.ping()
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select now() $$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
