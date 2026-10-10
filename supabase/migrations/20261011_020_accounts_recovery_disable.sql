-- Cuentas: recuperación fácil, deshabilitar jugadores y pedir ayuda sin crear cuentas nuevas.
--
-- PROBLEMA REAL: muchos jugadores olvidan su usuario o su contraseña y, al no poder entrar, se crean una cuenta nueva (duplicados).
-- · Restablecer contraseña funcionaba, pero los jugadores antiguos solo entraban con su CORREO; si no se acordaban de él, tampoco servía su usuario.
--   Ahora, al restablecer, la cuenta pasa a entrar con su NOMBRE DE USUARIO (el que se ve en el ranking) + la contraseña nueva.
-- · «Pedir ayuda» desde la pantalla de acceso (sin cuenta): el dueño lo ve en Gente y restablece con un toque.
-- · Aviso «parecido a un jugador existente» al registrarse, para que no se creen duplicados.
-- · Deshabilitar jugador: deja de aparecer en el ranking, la carrera y la actividad, no puede entrar ni operar, y libera su nombre. Reversible.
--   Eliminar definitivamente (solo después de deshabilitar) borra la cuenta y todos sus datos.

alter table public.profiles add column if not exists disabled_at timestamptz;
alter table public.profiles add column if not exists original_username text;
alter table public.profiles add column if not exists needs_password_change boolean not null default false;

create table if not exists public.help_requests (
  id         bigint generated always as identity primary key,
  name       text not null,
  note       text,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references public.profiles(id) on delete set null
);
alter table public.help_requests enable row level security;
create index if not exists help_requests_pending_idx on public.help_requests (handled_at, created_at);
revoke all on table public.help_requests from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Una cuenta deshabilitada no es staff ni puede operar (las funciones de operar llaman a _assert_active)
-- ---------------------------------------------------------------------
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (is_admin or is_moderator) and disabled_at is null from public.profiles where id = auth.uid()), false)
$$;

create or replace function public._assert_active()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.profiles where id = auth.uid() and disabled_at is not null) then
    raise exception 'Tu cuenta está deshabilitada. Pídele ayuda a Cheche.';
  end if;
end $$;
revoke all on function public._assert_active() from public, anon;
grant execute on function public._assert_active() to authenticated;

-- ---------------------------------------------------------------------
-- Ranking, carrera, perfiles, actividad y listas: sin jugadores deshabilitados
-- ---------------------------------------------------------------------
create or replace function public.get_leaderboard()
returns table(user_id uuid, username text, cash numeric, positions_value numeric, net_worth numeric, rank bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  return query
  select x.id, x.username, x.balance, x.pos, x.balance + x.pos,
         row_number() over (order by x.balance + x.pos desc, x.username)
  from (
    select p.id, p.username, p.balance, coalesce(v.pos, 0) as pos
    from public.profiles p
    left join lateral (
      select sum(s.count * case s.side
                             when 'YES' then m.no_pool / (m.yes_pool + m.no_pool)
                             else m.yes_pool / (m.yes_pool + m.no_pool)
                           end) as pos
      from public.shares s
      join public.markets m on m.id = s.market_id
      where s.user_id = p.id and not m.closed and s.count > 0
    ) v on true
    where p.username is not null and p.disabled_at is null
  ) x
  order by 6;
end $$;

create or replace function public._snapshot_networth(p_force boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_last timestamptz;
begin
  if not pg_try_advisory_xact_lock(7440123) then return; end if;
  select max(taken_at) into v_last from public.networth_snapshots;
  if p_force or v_last is null or v_last < now() - interval '5 minutes' then
    insert into public.networth_snapshots (user_id, cash, positions, net_worth)
    select p.id, p.balance, coalesce(v.pos, 0), p.balance + coalesce(v.pos, 0)
    from public.profiles p
    left join lateral (
      select sum(s.count * case s.side
                             when 'YES' then m.no_pool / (m.yes_pool + m.no_pool)
                             else m.yes_pool / (m.yes_pool + m.no_pool)
                           end) as pos
      from public.shares s
      join public.markets m on m.id = s.market_id
      where s.user_id = p.id and not m.closed and s.count > 0
    ) v on true
    where p.username is not null and p.disabled_at is null;
  end if;
end $$;

create or replace function public.get_networth_race(p_since timestamptz default null, p_max_points integer default 60)
returns table(user_id uuid, username text, taken_at timestamptz, net_worth numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_max int := least(greatest(coalesce(p_max_points, 60), 10), 200);
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  return query
  with src as (
    select s.user_id, s.taken_at, s.net_worth, s.id
    from public.networth_snapshots s
    where p_since is null or s.taken_at >= p_since
  ), hh as (
    select x.user_id, x.taken_at, x.net_worth,
           row_number() over (partition by x.user_id order by x.taken_at, x.id) as rn,
           count(*) over (partition by x.user_id) as cnt
    from src x
  )
  select hh.user_id, p.username, hh.taken_at, hh.net_worth
  from hh
  join public.profiles p on p.id = hh.user_id
  where p.username is not null and p.disabled_at is null
    and (hh.cnt <= v_max or hh.rn = 1 or hh.rn = hh.cnt
         or hh.rn % ceil(hh.cnt::numeric / v_max)::int = 0)
  order by hh.taken_at, p.username;
end $$;

create or replace function public.get_recent_activity(p_limit integer default 20, p_market_id uuid default null, p_group_id uuid default null)
returns table(kind text, at timestamptz, username text, market_id uuid, question text, group_topic text, side text, amount numeric, outcome text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_lim int := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  return query
  select e.kind, e.at, e.username, e.market_id, e.question, e.group_topic, e.side, e.amount, e.outcome
  from (
    (select t.type::text as kind, t.created_at as at, p.username, t.market_id, m.question, m.group_topic,
            t.side::text as side, t.total_cost as amount, null::text as outcome
     from public.transactions t
     join public.markets m on m.id = t.market_id
     join public.profiles p on p.id = t.user_id
     where t.type in ('BUY', 'SELL')
       and p.disabled_at is null
       and public.can_see_market(m.target_users, m.created_by)
       and (p_market_id is null or t.market_id = p_market_id)
       and (p_group_id is null or m.group_id = p_group_id)
     order by t.created_at desc limit v_lim)
    union all
    (select 'MARKET_NEW'::text, m.created_at, cp.username, m.id, m.question, m.group_topic,
            null::text, null::numeric, null::text
     from (select x.*, row_number() over (partition by coalesce(x.group_id, x.id) order by x.id) as rn
           from public.markets x
           where public.can_see_market(x.target_users, x.created_by)
             and (p_market_id is null or x.id = p_market_id)
             and (p_group_id is null or x.group_id = p_group_id)) m
     left join public.profiles cp on cp.id = m.created_by
     where m.rn = 1
     order by m.created_at desc limit v_lim)
    union all
    (select 'MARKET_RESOLVED'::text, m.resolved_at, null::text, m.id, m.question, m.group_topic,
            null::text, null::numeric, m.outcome
     from public.markets m
     where m.closed and m.resolved_at is not null
       and public.can_see_market(m.target_users, m.created_by)
       and (p_market_id is null or m.id = p_market_id)
       and (p_group_id is null or m.group_id = p_group_id)
     order by m.resolved_at desc limit v_lim)
  ) e
  order by e.at desc
  limit v_lim;
end $$;

create or replace function public.staff_list_players()
returns table(id uuid, username text, is_moderator boolean, is_admin boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Solo administradores o moderadores'; end if;
  return query
  select p.id, p.username, p.is_moderator, p.is_admin
  from public.profiles p where p.username is not null and p.disabled_at is null order by lower(p.username);
end $$;

-- Perfil de jugador: un jugador deshabilitado ya no existe para los demás
create or replace function public.get_player_profile(p_user_id uuid)
returns json language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid      uuid := auth.uid();
  v_name     text;
  v_since    timestamptz;
  v_cash     numeric;
  v_pos      numeric;
  v_net      numeric;
  v_rank     bigint;
  v_players  int;
  v_trades   int;
  v_traded   int;
  v_open     int;
  v_fav      text;
  v_wins     int := 0;
  v_losses   int := 0;
  v_best     numeric;
  v_best_q   text;
  v_worst    numeric;
  v_worst_q  text;
  v_kind     text;
  v_run      int := 0;
  v_best_run int := 0;
  v_total_pl numeric := 0;
  r          record;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;

  select p.username, p.created_at into v_name, v_since
  from public.profiles p where p.id = p_user_id and p.username is not null and p.disabled_at is null;
  if not found then raise exception 'Jugador no encontrado'; end if;

  select l.cash, l.positions_value, l.net_worth, l.rank into v_cash, v_pos, v_net, v_rank
  from public.get_leaderboard() l where l.user_id = p_user_id;
  select count(*)::int into v_players from public.profiles where username is not null and disabled_at is null;

  select count(*)::int, count(distinct t.market_id)::int into v_trades, v_traded
  from public.transactions t
  join public.markets m on m.id = t.market_id
  where t.user_id = p_user_id and t.type in ('BUY', 'SELL')
    and public.can_see_market(m.target_users, m.created_by);

  select count(distinct s.market_id)::int into v_open
  from public.shares s
  join public.markets m on m.id = s.market_id
  where s.user_id = p_user_id and s.count > 0 and not m.closed
    and public.can_see_market(m.target_users, m.created_by);

  select m.category into v_fav
  from public.transactions t
  join public.markets m on m.id = t.market_id
  where t.user_id = p_user_id and t.type in ('BUY', 'SELL')
    and public.can_see_market(m.target_users, m.created_by)
  group by m.category
  order by count(*) desc, m.category
  limit 1;

  for r in
    select m.question, m.group_topic, m.resolved_at,
           sum(case t.type when 'BUY' then -t.total_cost when 'SELL' then t.total_cost
                           when 'RESOLVE' then t.total_cost end) as profit
    from public.markets m
    join public.transactions t on t.market_id = m.id and t.user_id = p_user_id
    where m.closed and m.outcome in ('YES', 'NO')
      and public.can_see_market(m.target_users, m.created_by)
    group by m.id, m.question, m.group_topic, m.resolved_at
    order by m.resolved_at, m.id
  loop
    continue when r.profit is null or round(r.profit, 4) = 0;
    v_total_pl := v_total_pl + r.profit;
    if r.profit > 0 then
      v_wins := v_wins + 1;
      if v_kind = 'W' then v_run := v_run + 1; else v_kind := 'W'; v_run := 1; end if;
      v_best_run := greatest(v_best_run, v_run);
      if v_best is null or r.profit > v_best then
        v_best := r.profit; v_best_q := coalesce(r.group_topic, r.question);
      end if;
    else
      v_losses := v_losses + 1;
      if v_kind = 'L' then v_run := v_run + 1; else v_kind := 'L'; v_run := 1; end if;
      if v_worst is null or r.profit < v_worst then
        v_worst := r.profit; v_worst_q := coalesce(r.group_topic, r.question);
      end if;
    end if;
  end loop;

  return json_build_object(
    'user_id', p_user_id,
    'username', v_name,
    'member_since', v_since,
    'rank', v_rank,
    'players', v_players,
    'net_worth', v_net,
    'cash', v_cash,
    'positions_value', v_pos,
    'trades', v_trades,
    'markets_traded', v_traded,
    'open_markets', v_open,
    'favorite_category', v_fav,
    'wins', v_wins,
    'losses', v_losses,
    'win_rate', case when v_wins + v_losses > 0 then round(v_wins::numeric / (v_wins + v_losses), 4) else null end,
    'realized_pl', round(v_total_pl, 4),
    'current_streak', v_run,
    'current_streak_kind', v_kind,
    'best_win_streak', v_best_run,
    'best_win', json_build_object('amount', v_best, 'question', v_best_q),
    'worst_loss', json_build_object('amount', v_worst, 'question', v_worst_q)
  );
end $$;

-- ---------------------------------------------------------------------
-- Registro: los deshabilitados no cuentan para el cupo; aviso de nombres parecidos
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

  if v_provider = 'email' and v_code <> '' then
    select * into cfg from public.signup_config limit 1;
    if not cfg.is_open then raise exception 'SIGNUP_CLOSED: el registro está cerrado'; end if;
    if v_code <> public.norm_code(cfg.code) then raise exception 'BAD_CODE: código incorrecto'; end if;
    if (select count(*) from public.profiles where disabled_at is null) >= cfg.max_players then raise exception 'SIGNUP_FULL: ya no hay cupo'; end if;
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

create or replace function public.signup_status()
returns json language sql stable security definer set search_path = public, pg_temp as $$
  select json_build_object(
    'open', c.is_open,
    'full', (select count(*) from public.profiles where disabled_at is null) >= c.max_players
  ) from public.signup_config c limit 1
$$;

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
  if (select count(*) from public.profiles where disabled_at is null) >= cfg.max_players then return json_build_object('ok', false, 'reason', 'full'); end if;
  if v_name <> '' then
    if v_name !~ '^[A-Za-z0-9_]{3,20}$' then return json_build_object('ok', false, 'reason', 'username_invalid'); end if;
    if exists (select 1 from public.profiles where lower(username) = lower(v_name)) then
      return json_build_object('ok', false, 'reason', 'username_taken');
    end if;
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_get_signup()
returns json language plpgsql stable security definer set search_path = public, pg_temp as $$
declare cfg public.signup_config;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño puede ver el registro'; end if;
  select * into cfg from public.signup_config limit 1;
  return json_build_object('code', cfg.code, 'is_open', cfg.is_open, 'max_players', cfg.max_players,
                           'players', (select count(*) from public.profiles where disabled_at is null));
end $$;

-- Nombres parecidos a jugadores que ya existen (solo con el código correcto): evita cuentas duplicadas por olvido
create or replace function public.similar_players(p_code text, p_username text)
returns json language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cfg public.signup_config;
  v_k text := regexp_replace(lower(coalesce(p_username, '')), '[^a-z]', '', 'g');
begin
  select * into cfg from public.signup_config limit 1;
  if public.norm_code(p_code) = '' or public.norm_code(p_code) <> public.norm_code(cfg.code) or char_length(v_k) < 3 then
    return '[]'::json;
  end if;
  return coalesce((
    select json_agg(s.username order by s.username)
    from (
      select p.username
      from public.profiles p
      where p.username is not null and p.disabled_at is null
        and lower(p.username) <> lower(btrim(p_username))
        and (regexp_replace(lower(p.username), '[^a-z]', '', 'g') = v_k
             or (char_length(v_k) >= 4 and (regexp_replace(lower(p.username), '[^a-z]', '', 'g') like v_k || '%'
                                            or v_k like regexp_replace(lower(p.username), '[^a-z]', '', 'g') || '%')
                 and char_length(regexp_replace(lower(p.username), '[^a-z]', '', 'g')) >= 4))
      limit 3
    ) s
  ), '[]'::json);
end $$;
revoke all on function public.similar_players(text, text) from public;
grant execute on function public.similar_players(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Pedir ayuda sin cuenta (olvidé mi usuario / contraseña)
-- ---------------------------------------------------------------------
create or replace function public.request_help(p_name text, p_note text default null)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 200), '');
begin
  if char_length(v_name) < 2 or char_length(v_name) > 60 then return json_build_object('ok', false, 'reason', 'invalid'); end if;
  if (select count(*) from public.help_requests where created_at > now() - interval '1 hour') >= 40 then
    return json_build_object('ok', false, 'reason', 'locked');
  end if;
  if exists (select 1 from public.help_requests where handled_at is null and lower(name) = lower(v_name) and created_at > now() - interval '1 day') then
    return json_build_object('ok', true, 'already', true);
  end if;
  insert into public.help_requests (name, note) values (v_name, v_note);
  return json_build_object('ok', true);
end $$;
revoke all on function public.request_help(text, text) from public;
grant execute on function public.request_help(text, text) to anon, authenticated;

create or replace function public.admin_list_help_requests()
returns json language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño'; end if;
  return coalesce((
    select json_agg(x order by x.created_at desc)
    from (
      select h.id, h.name, h.note, h.created_at,
             coalesce((
               select json_agg(json_build_object('id', p.id, 'username', p.username) order by p.username)
               from (
                 select p2.id, p2.username from public.profiles p2
                 where p2.username is not null and p2.disabled_at is null and not p2.is_admin
                   and (lower(p2.username) like '%' || lower(replace(replace(h.name, '%', ''), '_', '')) || '%'
                        or lower(h.name) like '%' || lower(p2.username) || '%')
                 limit 5
               ) p
             ), '[]'::json) as matches
      from public.help_requests h where h.handled_at is null
    ) x
  ), '[]'::json);
end $$;

create or replace function public.admin_handle_help_request(p_id bigint)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño'; end if;
  update public.help_requests set handled_at = now(), handled_by = auth.uid() where id = p_id and handled_at is null;
  return json_build_object('success', true);
end $$;

-- ---------------------------------------------------------------------
-- Lista de jugadores para el dueño (con cómo entra cada uno) y restablecer contraseña mejorado
-- ---------------------------------------------------------------------
drop function if exists public.admin_list_players();
create or replace function public.admin_list_players()
returns table(id uuid, username text, balance numeric, is_admin boolean, is_moderator boolean, created_at timestamptz,
              disabled_at timestamptz, login_kind text, email_hint text, needs_password_change boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño'; end if;
  return query
  select p.id, p.username, p.balance, p.is_admin, p.is_moderator, p.created_at, p.disabled_at,
         case when u.email like '%@jugador.familymarket.invalid' then 'usuario' else 'correo' end,
         case when u.email like '%@jugador.familymarket.invalid' then null
              else left(split_part(u.email, '@', 1), 2) || '***@' || split_part(u.email, '@', 2) end,
         p.needs_password_change
  from public.profiles p left join auth.users u on u.id = p.id
  order by (p.disabled_at is not null), lower(p.username) nulls last;
end $$;
revoke all on function public.admin_list_players() from public, anon;
grant execute on function public.admin_list_players() to authenticated;

create or replace function public.admin_reset_password(p_user_id uuid, p_new_password text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name      text;
  v_disabled  timestamptz;
  v_email     text;
  v_new_email text;
  v_converted boolean := false;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño puede restablecer contraseñas'; end if;
  if p_new_password is null or char_length(p_new_password) < 6 or char_length(p_new_password) > 72 then
    raise exception 'La contraseña debe tener entre 6 y 72 caracteres';
  end if;
  select username, disabled_at into v_name, v_disabled from public.profiles where id = p_user_id;
  if not found then raise exception 'Jugador no encontrado'; end if;
  if v_disabled is not null then raise exception 'Esa cuenta está deshabilitada. Rehabilítala primero.'; end if;

  -- Los jugadores antiguos entraban con su correo; ahora pasan a entrar con su NOMBRE DE USUARIO (lo ven en el ranking).
  select email into v_email from auth.users where id = p_user_id;
  if v_name is not null then
    v_new_email := lower(v_name) || '@jugador.familymarket.invalid';
    if v_email is distinct from v_new_email
       and not exists (select 1 from auth.users where email = v_new_email and id <> p_user_id) then
      update auth.users set email = v_new_email, email_confirmed_at = coalesce(email_confirmed_at, now()) where id = p_user_id;
      update auth.identities set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_new_email)), updated_at = now()
      where user_id = p_user_id and provider = 'email';
      update public.profiles set email = v_new_email where id = p_user_id;
      v_converted := true;
    end if;
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')), updated_at = now()
  where id = p_user_id;
  delete from auth.sessions where user_id = p_user_id;
  update public.profiles set needs_password_change = true where id = p_user_id;
  update public.help_requests set handled_at = now(), handled_by = auth.uid()
  where handled_at is null and v_name is not null and lower(name) = lower(v_name);
  perform public.log_admin_action('reset_password', p_user_id, null,
    jsonb_build_object('username', v_name, 'converted_to_username', v_converted, 'previous_email', case when v_converted then v_email end));
  return json_build_object('success', true, 'username', v_name, 'login_with_username', v_name is not null, 'converted', v_converted);
end $$;

-- El propio jugador cambia su contraseña desde la app (después de entrar con la temporal)
create or replace function public.password_changed()
returns json language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  update public.profiles set needs_password_change = false where id = auth.uid();
  return json_build_object('success', true);
end $$;
revoke all on function public.password_changed() from public, anon;
grant execute on function public.password_changed() to authenticated;

-- ---------------------------------------------------------------------
-- Deshabilitar / rehabilitar / eliminar
-- ---------------------------------------------------------------------
create or replace function public.admin_disable_player(p_user_id uuid)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p          public.profiles;
  v_base     text;
  v_new      text;
  v_n        int := 0;
  v_email    text;
  v_new_mail text;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño puede deshabilitar jugadores'; end if;
  select * into p from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Jugador no encontrado'; end if;
  if p.is_admin then raise exception 'No se puede deshabilitar al dueño'; end if;
  if p.disabled_at is not null then raise exception 'Ese jugador ya está deshabilitado'; end if;

  -- Libera su nombre (para que la persona pueda volver a usarlo en su cuenta nueva)
  v_base := left(coalesce(p.username, 'sin_nombre'), 14);
  loop
    v_new := v_base || '_off' || case when v_n = 0 then '' else v_n::text end;
    exit when not exists (select 1 from public.profiles where lower(username) = lower(v_new));
    v_n := v_n + 1;
  end loop;

  select email into v_email from auth.users where id = p_user_id;
  if v_email like '%@jugador.familymarket.invalid' then
    v_new_mail := lower(v_new) || '@jugador.familymarket.invalid';
    update auth.users set email = v_new_mail where id = p_user_id;
    update auth.identities set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_new_mail)), updated_at = now()
    where user_id = p_user_id and provider = 'email';
    update public.profiles set email = v_new_mail where id = p_user_id;
  end if;

  update auth.users set banned_until = now() + interval '100 years' where id = p_user_id;
  delete from auth.sessions where user_id = p_user_id;
  update public.profiles set disabled_at = now(), original_username = p.username, username = v_new where id = p_user_id;
  perform public._snapshot_networth(true);
  perform public.log_admin_action('disable_player', p_user_id, p.balance, jsonb_build_object('username', p.username, 'renamed_to', v_new));
  return json_build_object('success', true, 'username', v_new, 'original_username', p.username);
end $$;

create or replace function public.admin_enable_player(p_user_id uuid)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p          public.profiles;
  v_target   text;
  v_email    text;
  v_new_mail text;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño puede rehabilitar jugadores'; end if;
  select * into p from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Jugador no encontrado'; end if;
  if p.disabled_at is null then raise exception 'Ese jugador no está deshabilitado'; end if;

  v_target := p.username;
  if p.original_username is not null and not exists (
       select 1 from public.profiles where lower(username) = lower(p.original_username) and id <> p_user_id) then
    v_target := p.original_username;
  end if;

  select email into v_email from auth.users where id = p_user_id;
  if v_email like '%@jugador.familymarket.invalid' then
    v_new_mail := lower(v_target) || '@jugador.familymarket.invalid';
    if not exists (select 1 from auth.users where email = v_new_mail and id <> p_user_id) then
      update auth.users set email = v_new_mail where id = p_user_id;
      update auth.identities set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_new_mail)), updated_at = now()
      where user_id = p_user_id and provider = 'email';
      update public.profiles set email = v_new_mail where id = p_user_id;
    end if;
  end if;

  update auth.users set banned_until = null where id = p_user_id;
  update public.profiles set disabled_at = null, username = v_target, original_username = null where id = p_user_id;
  perform public._snapshot_networth(true);
  perform public.log_admin_action('enable_player', p_user_id, p.balance, jsonb_build_object('username', v_target));
  return json_build_object('success', true, 'username', v_target, 'name_kept', v_target is not distinct from p.original_username);
end $$;

-- Eliminar definitivamente: solo a un jugador ya deshabilitado (dos pasos, para no equivocarse).
-- Se borran su cuenta, sus acciones, operaciones y avisos. Sus acciones en mercados abiertos desaparecen.
create or replace function public.admin_delete_player(p_user_id uuid)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p        public.profiles;
  v_email  text;
  v_pos    int;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo el dueño puede eliminar jugadores'; end if;
  select * into p from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Jugador no encontrado'; end if;
  if p.is_admin then raise exception 'No se puede eliminar al dueño'; end if;
  if p.disabled_at is null then raise exception 'Primero deshabilita al jugador; después se puede eliminar'; end if;

  select count(distinct s.market_id)::int into v_pos
  from public.shares s join public.markets m on m.id = s.market_id
  where s.user_id = p_user_id and s.count > 0 and not m.closed;
  select email into v_email from auth.users where id = p_user_id;

  delete from public.invited_emails where email_key = public.norm_email(coalesce(v_email, ''));
  delete from auth.users where id = p_user_id;
  perform public._snapshot_networth(true);
  perform public.log_admin_action('delete_player', null, p.balance,
    jsonb_build_object('username', coalesce(p.original_username, p.username), 'open_positions_removed', v_pos));
  return json_build_object('success', true, 'open_positions_removed', v_pos);
end $$;

revoke all on function public.admin_list_help_requests() from public, anon;
revoke all on function public.admin_handle_help_request(bigint) from public, anon;
revoke all on function public.admin_reset_password(uuid, text) from public, anon;
revoke all on function public.admin_disable_player(uuid) from public, anon;
revoke all on function public.admin_enable_player(uuid) from public, anon;
revoke all on function public.admin_delete_player(uuid) from public, anon;
grant execute on function public.admin_list_help_requests() to authenticated;
grant execute on function public.admin_handle_help_request(bigint) to authenticated;
grant execute on function public.admin_reset_password(uuid, text) to authenticated;
grant execute on function public.admin_disable_player(uuid) to authenticated;
grant execute on function public.admin_enable_player(uuid) to authenticated;
grant execute on function public.admin_delete_player(uuid) to authenticated;
