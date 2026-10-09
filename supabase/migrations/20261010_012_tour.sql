-- =====================================================================
-- 012 · Tutorial interactivo: se muestra UNA vez por jugador (el dato vive en el servidor,
--       así que vale en cualquier celular o navegador desde el que entre).
-- =====================================================================
alter table public.profiles add column if not exists tour_completed_at timestamptz;

create or replace function public.complete_tour()
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v timestamptz;
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  update public.profiles set tour_completed_at = coalesce(tour_completed_at, now())
  where id = auth.uid()
  returning tour_completed_at into v;
  if not found then raise exception 'Perfil no encontrado'; end if;
  return json_build_object('success', true, 'tour_completed_at', v);
end $$;

revoke all on function public.complete_tour() from public, anon;
grant execute on function public.complete_tour() to authenticated;
