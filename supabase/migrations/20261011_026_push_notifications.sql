-- 026 · Notificaciones push (Android y iPhone): suscripciones, preferencias, eventos y envío programado
--
-- Cómo funciona (todo gratis, sin servicios de terceros):
--   1. Cada teléfono que activa las notificaciones guarda su suscripción Web Push (`push_subscriptions`).
--   2. Los eventos del juego (mercado nuevo, apuestas cerradas, «cierra pronto», resultados, premios, sugerencias)
--      se anotan en `push_events` por disparadores / revisiones periódicas. Nada de esto puede romper una operación:
--      todo va envuelto en bloques con excepción.
--   3. `push_nudge()` (pg_cron cada minuto, y al instante cuando hay resultados) avisa a la función de borde
--      `send-push`, que pide los mensajes ya armados con `push_claim_jobs()` y los envía con Web Push (VAPID).
--   4. Reglas: nunca se avisa de un mercado sorpresa a quien se le ocultó; al creador no se le avisa de lo suyo;
--      varios mercados nuevos seguidos se juntan en UN solo aviso; cada jugador elige qué avisos quiere.
-- Las claves VAPID y el secreto compartido viven en `push_config` (sin acceso desde la API); las claves las genera la
-- propia función la primera vez, así que NO están en el repositorio.
-- Requiere las extensiones pg_net y pg_cron (create extension).

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create table if not exists public.push_config (
  id            boolean primary key default true check (id),
  vapid_public  text,
  vapid_private text,
  vapid_subject text not null default 'https://familymarket-rho.vercel.app',
  function_url  text not null,
  secret        text not null
);
alter table public.push_config enable row level security;
revoke all on public.push_config from public, anon, authenticated;
insert into public.push_config (function_url, secret)
values ('https://tbxwqxuandxibpwoshuc.supabase.co/functions/v1/send-push', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (id) do nothing;

create table if not exists public.push_subscriptions (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth_key     text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  failures     integer not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;

create table if not exists public.push_prefs (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  new_markets boolean not null default true,
  closing     boolean not null default true,
  results     boolean not null default true,
  suggestions boolean not null default true,
  updated_at  timestamptz not null default now()
);
alter table public.push_prefs enable row level security;
revoke all on public.push_prefs from public, anon, authenticated;

create table if not exists public.push_events (
  id              bigint generated always as identity primary key,
  kind            text not null check (kind in ('market_new', 'market_closed', 'closing_soon', 'notif', 'test')),
  market_id       uuid,
  notification_id uuid,
  user_id         uuid,
  created_at      timestamptz not null default now(),
  send_after      timestamptz not null default now(),
  processed_at    timestamptz
);
create unique index if not exists push_events_once on public.push_events (kind, market_id) where kind in ('market_new', 'market_closed', 'closing_soon');
create index if not exists push_events_pending on public.push_events (send_after) where processed_at is null;
alter table public.push_events enable row level security;
revoke all on public.push_events from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Avisar a la función de envío (pg_net, asíncrono y después de confirmar la transacción). Nunca lanza errores.
-- ---------------------------------------------------------------------
create or replace function public.push_nudge(p_scan boolean default true)
returns void
language plpgsql security definer set search_path = public, extensions, net, pg_temp as $$
declare
  cfg       public.push_config;
  v_pending int;
begin
  if p_scan then
    begin perform public.push_enqueue_scans(); exception when others then null; end;
    begin delete from public.push_events where processed_at is not null and processed_at < now() - interval '7 days'; exception when others then null; end;
  end if;
  select * into cfg from public.push_config limit 1;
  if not found then return; end if;
  select count(*) into v_pending from public.push_events e where e.processed_at is null and e.send_after <= now();
  -- sin claves todavía: se llama una vez para que la función las genere
  if v_pending > 0 or cfg.vapid_public is null then
    perform net.http_post(
      url := cfg.function_url,
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.secret),
      timeout_milliseconds := 8000);
  end if;
exception when others then
  null;
end $$;
revoke all on function public.push_nudge(boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Revisiones periódicas: apuestas cerradas y «cierra pronto»
-- ---------------------------------------------------------------------
create or replace function public.push_enqueue_scans()
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Apuestas cerradas (por la fecha o a mano) en los últimos 15 min y todavía sin resolver
  insert into public.push_events (kind, market_id)
  select 'market_closed', m.id from public.markets m
  where not m.closed and m.closes_at is not null and m.closes_at <= now() and m.closes_at > now() - interval '15 minutes'
    and (m.opens_at is null or m.opens_at <= m.closes_at)
  on conflict do nothing;
  -- Cierran en los próximos 15 min
  insert into public.push_events (kind, market_id)
  select 'closing_soon', m.id from public.markets m
  where not m.closed and m.closes_at is not null and m.closes_at > now() and m.closes_at <= now() + interval '15 minutes'
    and (m.opens_at is null or m.opens_at <= now())
  on conflict do nothing;
end $$;
revoke all on function public.push_enqueue_scans() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Disparadores (a prueba de fallos: jamás pueden romper crear, abrir ni resolver un mercado)
-- ---------------------------------------------------------------------
create or replace function public.push_on_market_insert()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    insert into public.push_events (kind, market_id, send_after)
    values ('market_new', new.id, coalesce(new.opens_at, now()))
    on conflict do nothing;
  exception when others then null;
  end;
  return null;
end $$;
drop trigger if exists push_market_insert on public.markets;
create trigger push_market_insert after insert on public.markets
  for each row execute function public.push_on_market_insert();

create or replace function public.push_on_market_update()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    -- «Abrir ya» o reprogramar la apertura: el aviso de mercado nuevo sigue a la nueva hora
    update public.push_events e set send_after = coalesce(new.opens_at, now())
    where e.kind = 'market_new' and e.market_id = new.id and e.processed_at is null;
  exception when others then null;
  end;
  return null;
end $$;
drop trigger if exists push_market_update on public.markets;
create trigger push_market_update after update of opens_at on public.markets
  for each row when (old.opens_at is distinct from new.opens_at)
  execute function public.push_on_market_update();

create or replace function public.push_on_notifications()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    insert into public.push_events (kind, user_id, notification_id)
    select 'notif', n.user_id, n.id from new_rows n
    where n.kind in ('MARKET_WON', 'MARKET_LOST', 'HIDDEN_REWARD', 'MARKET_REOPENED', 'MARKET_CANCELLED', 'SUGGESTION_APPROVED', 'SUGGESTION_REJECTED');
    perform public.push_nudge(false);
  exception when others then null;
  end;
  return null;
end $$;
drop trigger if exists push_notifications_ins on public.notifications;
create trigger push_notifications_ins after insert on public.notifications
  referencing new table as new_rows
  for each statement execute function public.push_on_notifications();

-- ---------------------------------------------------------------------
-- El motor: reclama los eventos pendientes y devuelve los mensajes ya armados (uno por teléfono)
-- ---------------------------------------------------------------------
create or replace function public.push_claim_jobs()
returns table (user_id uuid, endpoint text, p256dh text, auth_key text, title text, body text, url text, tag text, kind text, ttl integer)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_hold boolean;
begin
  -- Mercados nuevos: si se están creando varios seguidos se espera a que pare la racha
  -- (60 s sin mercados nuevos; como máximo 5 min) para mandar UN solo aviso.
  select exists (select 1 from public.push_events x where x.kind = 'market_new' and x.processed_at is null and x.send_after <= now() and x.created_at > now() - interval '60 seconds')
     and not exists (select 1 from public.push_events x where x.kind = 'market_new' and x.processed_at is null and x.send_after <= now() and x.created_at < now() - interval '5 minutes')
    into v_hold;

  drop table if exists _pc_ev;
  drop table if exists _pc_msg;
  create temp table _pc_ev on commit drop as select * from public.push_events where false;
  create temp table _pc_msg (user_id uuid, title text, body text, url text, tag text, kind text, ttl int) on commit drop;

  with c as (
    update public.push_events e set processed_at = now()
    where e.id in (select x.id from public.push_events x
                   where x.processed_at is null and x.send_after <= now() and (not v_hold or x.kind <> 'market_new')
                   order by x.id limit 500 for update skip locked)
    returning e.*
  )
  insert into _pc_ev select * from c;

  -- 1) Mercados nuevos (y los programados que ya abrieron): un aviso por jugador
  with items as (
    select coalesce(m.group_id, m.id) as gkey,
           array_agg(m.id order by m.id) as ids,
           (array_agg(m.id order by m.id))[1] as first_id,
           (array_agg(m.group_id))[1] as group_id,
           coalesce(max(m.group_topic), min(m.question)) as name,
           count(*)::int as options,
           bool_or(m.opens_at is not null) as scheduled,
           min(m.created_at) as created_at
    from _pc_ev e join public.markets m on m.id = e.market_id
    where e.kind = 'market_new' and not m.closed and (m.opens_at is null or m.opens_at <= now())
    group by coalesce(m.group_id, m.id)
  ), aud as (
    select u.id as uid, i.*
    from items i
    join public.markets fm on fm.id = i.first_id
    join public.profiles u on u.username is not null and u.disabled_at is null
    where (u.id <> all (coalesce(fm.target_users, '{}'::uuid[])) or u.is_admin or u.id = fm.created_by)
      and u.id is distinct from fm.created_by
      and coalesce((select pp.new_markets from public.push_prefs pp where pp.user_id = u.id), true)
      and exists (select 1 from public.push_subscriptions s where s.user_id = u.id)
      and not exists (select 1 from public.notifications n where n.user_id = u.id and n.kind = 'SUGGESTION_APPROVED' and n.market_id = any (i.ids))
  )
  insert into _pc_msg (user_id, title, body, url, tag, kind, ttl)
  select a.uid,
         case when count(*) = 1 then (case when bool_or(a.scheduled) then '⏰ Ya abrió un mercado' else '🆕 Mercado nuevo' end)
              else '🆕 ' || count(*) || ' mercados nuevos' end,
         case when count(*) = 1 then max(a.name) || (case when max(a.options) > 1 then ' · ' || max(a.options) || ' opciones' else '' end)
              else array_to_string((array_agg(a.name order by a.created_at, a.gkey))[1:2], ' · ') || (case when count(*) > 2 then ' y ' || (count(*) - 2) || ' más' else '' end) end,
         case when count(*) = 1 then (case when (array_agg(a.group_id))[1] is not null then '/g/' || (array_agg(a.group_id))[1]::text else '/m/' || (array_agg(a.first_id))[1]::text end)
              else '/' end,
         'market-new', 'market_new', 21600
  from aud a
  group by a.uid;

  -- 2) Apuestas cerradas: solo a quienes tienen acciones en ese mercado
  with items as (
    select coalesce(m.group_id, m.id) as gkey,
           array_agg(m.id) as ids,
           (array_agg(m.id order by m.id))[1] as first_id,
           (array_agg(m.group_id))[1] as group_id,
           coalesce(max(m.group_topic), min(m.question)) as name
    from _pc_ev e join public.markets m on m.id = e.market_id
    where e.kind = 'market_closed' and not m.closed
    group by coalesce(m.group_id, m.id)
  )
  insert into _pc_msg (user_id, title, body, url, tag, kind, ttl)
  select h.uid, '🔒 Apuestas cerradas', i.name || ' · esperando el resultado',
         case when i.group_id is not null then '/g/' || i.group_id::text else '/m/' || i.first_id::text end,
         'closed-' || i.gkey::text, 'market_closed', 10800
  from items i
  cross join lateral (select distinct s.user_id as uid from public.shares s where s.market_id = any (i.ids) and s.count > 0) h
  join public.profiles u on u.id = h.uid and u.username is not null and u.disabled_at is null
  where coalesce((select pp.closing from public.push_prefs pp where pp.user_id = u.id), true);

  -- 3) «Cierra pronto»: última llamada a quienes tienen acciones
  with items as (
    select coalesce(m.group_id, m.id) as gkey,
           array_agg(m.id) as ids,
           (array_agg(m.id order by m.id))[1] as first_id,
           (array_agg(m.group_id))[1] as group_id,
           coalesce(max(m.group_topic), min(m.question)) as name,
           min(m.closes_at) as closes_at
    from _pc_ev e join public.markets m on m.id = e.market_id
    where e.kind = 'closing_soon' and not m.closed and m.closes_at > now()
    group by coalesce(m.group_id, m.id)
  )
  insert into _pc_msg (user_id, title, body, url, tag, kind, ttl)
  select h.uid, '⏳ Última llamada',
         i.name || ' cierra en ' || greatest(ceil(extract(epoch from (i.closes_at - now())) / 60), 1)::int || ' min',
         case when i.group_id is not null then '/g/' || i.group_id::text else '/m/' || i.first_id::text end,
         'closing-' || i.gkey::text, 'closing_soon', 600
  from items i
  cross join lateral (select distinct s.user_id as uid from public.shares s where s.market_id = any (i.ids) and s.count > 0) h
  join public.profiles u on u.id = h.uid and u.username is not null and u.disabled_at is null
  where coalesce((select pp.closing from public.push_prefs pp where pp.user_id = u.id), true);

  -- 4) Resultados, premios y sugerencias (salen de las mismas notificaciones que ve el jugador dentro de la app)
  with n as (
    select nt.id as nid, nt.user_id as uid, nt.kind as nkind, nt.market_id as market_id, nt.payload as payload,
           case when nt.kind in ('MARKET_WON', 'MARKET_LOST', 'HIDDEN_REWARD', 'MARKET_REOPENED', 'MARKET_CANCELLED') then 'results'
                when nt.kind in ('SUGGESTION_APPROVED', 'SUGGESTION_REJECTED') then 'suggestions' end as cat,
           case when nullif(nt.payload ->> 'group_topic', '') is not null then (nt.payload ->> 'group_topic') || ' — ' || coalesce(nt.payload ->> 'question', '')
                else coalesce(nt.payload ->> 'question', 'Mercado') end as q
    from _pc_ev e
    join public.notifications nt on nt.id = e.notification_id and nt.seen_at is null
    join public.profiles u on u.id = nt.user_id and u.username is not null and u.disabled_at is null
    where e.kind = 'notif'
      and coalesce((select case when nt.kind in ('SUGGESTION_APPROVED', 'SUGGESTION_REJECTED') then pp.suggestions else pp.results end
                    from public.push_prefs pp where pp.user_id = nt.user_id), true)
  ), msgs as (
    select n.uid, n.cat,
           case n.nkind
             when 'MARKET_WON' then case when coalesce((n.payload ->> 'profit')::numeric, 0) > 0
                                         then '🏆 ¡Ganaste +$' || trim(to_char((n.payload ->> 'profit')::numeric, 'FM999999990.00')) || '!'
                                         else '✅ Acertaste · cobras $' || trim(to_char(coalesce((n.payload ->> 'payout')::numeric, 0), 'FM999999990.00')) end
             when 'MARKET_LOST' then '😔 Esta vez no fue'
             when 'HIDDEN_REWARD' then '🎁 ¡Premio sorpresa! +$' || trim(to_char(coalesce((n.payload ->> 'amount')::numeric, 0), 'FM999999990.00'))
             when 'MARKET_REOPENED' then '↩️ Se corrigió un resultado'
             when 'MARKET_CANCELLED' then '🧾 Mercado anulado'
             when 'SUGGESTION_APPROVED' then '🎉 ¡Tu sugerencia fue aprobada!'
             when 'SUGGESTION_REJECTED' then '📝 Sugerencia no aprobada'
           end as title,
           case n.nkind
             when 'MARKET_LOST' then n.q || ' · perdiste $' || trim(to_char(abs(coalesce((n.payload ->> 'profit')::numeric, 0)), 'FM999999990.00'))
             when 'HIDDEN_REWARD' then 'Por la apuesta que te ocultaron: ' || n.q
             when 'MARKET_CANCELLED' then n.q || ' · se ajustó tu saldo'
             when 'SUGGESTION_REJECTED' then n.q || coalesce(' · ' || nullif(n.payload ->> 'reason', ''), '')
             else n.q
           end as body,
           case when n.nkind = 'HIDDEN_REWARD' then '/portfolio'
                when n.market_id is not null then '/m/' || n.market_id::text
                when n.cat = 'suggestions' then '/sugerir'
                else '/portfolio' end as url,
           'notif-' || n.nid::text as tag
    from n where n.cat is not null
  ), c as (
    select m.uid, m.cat, count(*) as cnt from msgs m group by m.uid, m.cat
  )
  insert into _pc_msg (user_id, title, body, url, tag, kind, ttl)
  select m.uid, m.title, m.body, m.url, m.tag, 'notif', 21600
  from msgs m join c on c.uid = m.uid and c.cat = m.cat and c.cnt = 1
  union all
  select c.uid,
         case c.cat when 'results' then '🏆 ' || c.cnt || ' resultados nuevos' else '💡 ' || c.cnt || ' novedades de tus sugerencias' end,
         'Toca para verlos', case c.cat when 'results' then '/portfolio' else '/sugerir' end, 'notif-' || c.cat, 'notif', 21600
  from c where c.cnt > 1;

  -- 5) Prueba desde la app («Enviar una prueba»)
  insert into _pc_msg (user_id, title, body, url, tag, kind, ttl)
  select e.user_id, '🔔 ¡Funciona!', 'Las notificaciones de FamilyMarket están activas en este teléfono.', '/', 'test', 'test', 600
  from _pc_ev e where e.kind = 'test' and e.user_id is not null;

  return query
  select m.user_id, s.endpoint, s.p256dh, s.auth_key, m.title, m.body, m.url, m.tag, m.kind, m.ttl
  from _pc_msg m
  join public.push_subscriptions s on s.user_id = m.user_id
  order by m.user_id, s.id
  limit 1000;
end $$;
revoke all on function public.push_claim_jobs() from public, anon, authenticated;
grant execute on function public.push_claim_jobs() to service_role;

-- Un teléfono que ya no existe (404/410) se borra; los demás errores suman fallos y se borra al octavo seguido
create or replace function public.push_drop_endpoint(p_endpoint text, p_gone boolean default false)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_gone then
    delete from public.push_subscriptions s where s.endpoint = p_endpoint;
  else
    update public.push_subscriptions s set failures = s.failures + 1 where s.endpoint = p_endpoint;
    delete from public.push_subscriptions s where s.endpoint = p_endpoint and s.failures >= 8;
  end if;
end $$;
revoke all on function public.push_drop_endpoint(text, boolean) from public, anon, authenticated;
grant execute on function public.push_drop_endpoint(text, boolean) to service_role;

-- ---------------------------------------------------------------------
-- RPC para los jugadores (la app)
-- ---------------------------------------------------------------------
create or replace function public.get_push_state()
returns json
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  pp    public.push_prefs;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select * into pp from public.push_prefs x where x.user_id = v_uid;
  return json_build_object(
    'public_key', (select c.vapid_public from public.push_config c limit 1),
    'devices', (select count(*) from public.push_subscriptions s where s.user_id = v_uid),
    'prefs', json_build_object(
      'new_markets', coalesce(pp.new_markets, true), 'closing', coalesce(pp.closing, true),
      'results', coalesce(pp.results, true), 'suggestions', coalesce(pp.suggestions, true)));
end $$;

create or replace function public.set_push_prefs(p_new_markets boolean, p_closing boolean, p_results boolean, p_suggestions boolean)
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  insert into public.push_prefs (user_id, new_markets, closing, results, suggestions)
  values (v_uid, coalesce(p_new_markets, true), coalesce(p_closing, true), coalesce(p_results, true), coalesce(p_suggestions, true))
  on conflict (user_id) do update
    set new_markets = excluded.new_markets, closing = excluded.closing, results = excluded.results,
        suggestions = excluded.suggestions, updated_at = now();
  return json_build_object('success', true);
end $$;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Suscripción inválida';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.username is not null and p.disabled_at is null) then
    raise exception 'Cuenta no disponible';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth_key = excluded.auth_key,
        user_agent = excluded.user_agent, last_seen_at = now(), failures = 0;
  insert into public.push_prefs (user_id) values (v_uid) on conflict (user_id) do nothing;
  -- como máximo 5 teléfonos por jugador: se borran los más viejos
  delete from public.push_subscriptions s
  where s.user_id = v_uid
    and s.id not in (select x.id from public.push_subscriptions x where x.user_id = v_uid order by x.last_seen_at desc limit 5);
  return json_build_object('success', true);
end $$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  delete from public.push_subscriptions s where s.user_id = v_uid and s.endpoint = p_endpoint;
  return json_build_object('success', true);
end $$;

create or replace function public.push_send_test()
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  if not exists (select 1 from public.push_subscriptions s where s.user_id = v_uid) then
    raise exception 'Este teléfono todavía no tiene las notificaciones activadas';
  end if;
  if exists (select 1 from public.push_events e where e.kind = 'test' and e.user_id = v_uid and e.created_at > now() - interval '10 seconds') then
    raise exception 'Espera unos segundos antes de enviar otra prueba';
  end if;
  insert into public.push_events (kind, user_id) values ('test', v_uid);
  perform public.push_nudge(false);
  return json_build_object('success', true);
end $$;

revoke all on function public.get_push_state() from public, anon;
revoke all on function public.set_push_prefs(boolean, boolean, boolean, boolean) from public, anon;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.remove_push_subscription(text) from public, anon;
revoke all on function public.push_send_test() from public, anon;
grant execute on function public.get_push_state() to authenticated;
grant execute on function public.set_push_prefs(boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;
grant execute on function public.push_send_test() to authenticated;

-- ---------------------------------------------------------------------
-- Revisión cada minuto (cierres, «cierra pronto», aviso a la función de envío)
-- ---------------------------------------------------------------------
select cron.unschedule(j.jobid) from cron.job j where j.jobname = 'familymarket-push';
select cron.schedule('familymarket-push', '* * * * *', 'select public.push_nudge()');
