# Auditoría de FamilyMarket · octubre 2026

Revisión completa del proyecto original (hecho en un chat de Claude, sin esquema versionado) antes del viaje a
Margarita: seguridad, concurrencia, precisión matemática, rendimiento y experiencia de usuario.
Todo lo de esta lista está **corregido y cubierto por pruebas automáticas** (`npm run test:load`, `npm run test:ui`).

## 1. Seguridad (lo más grave)

| # | Hallazgo original | Impacto | Corrección |
|---|---|---|---|
| S1 | `admin_update_balance` no verificaba admin ni sesión | Cualquiera con la clave pública (visible en el JS de la app) podía ponerse o quitar dinero a cualquier jugador, incluso sin cuenta | Solo admin; no deja saldo negativo; queda en el registro de auditoría |
| S2 | `delete_market_and_refund` no verificaba admin | Cualquiera podía borrar mercados; en mercados ya resueltos devolvía además lo invertido → cobro doble | Solo admin; revierte compras − ventas − pagos de resolución |
| S3 | `profiles`: cada jugador podía `UPDATE` de su propia fila completa | Editar `balance` o ponerse `is_admin = true` desde la consola del navegador | Sin privilegios de escritura; el nombre se elige con `set_username` (validado, único sin distinguir mayúsculas) |
| S4 | `shares`, `transactions`, `transaction_logs`, `market_prices_history` con `INSERT/UPDATE` abierto a `public` (incluido anónimo) | Acciones gratis; historial falso; **quemar los 60 movimientos diarios de otro jugador** insertando logs a su nombre | Solo lectura de lo propio. Toda escritura va por RPC |
| S5 | Tablas `*_backup` en `public` **sin RLS** | Emails, saldos y operaciones legibles y editables por cualquiera | Movidas a un schema privado no expuesto por la API |
| S6 | Perfiles (con **emails**) legibles por todos, incluso anónimos | Filtración de correos de la familia | Cada jugador ve solo el suyo; el ranking sale de una RPC sin emails |
| S7 | `sell_shares` no comprobaba que el mercado estuviera abierto | Tras resolver (y cobrar $1/acción) se podían vender las mismas acciones otra vez al pool: dinero gratis | Mercado cerrado → rechazado |
| S8 | `resolve_market`: `IF NOT v_is_admin` (con `NULL` pasa) y sin bloquear el mercado | Carrera con operaciones en curso (compras que nunca se pagan) | `coalesce`, `FOR UPDATE` y pago en una sola sentencia |
| S9 | "Filtro fantasma" solo en el cliente | Un jugador podía ver y operar mercados que se le ocultaron | Filtro en RLS **y** dentro de `buy_shares`/`sell_shares` |
| S10 | Funciones `SECURITY DEFINER` sin `search_path`, ejecutables por `PUBLIC`/`anon` | Superficie de ataque innecesaria | `search_path` fijo; `EXECUTE` solo para usuarios autenticados |
| S11 | Sin validaciones de entrada en servidor | Valores `NaN`, lados inválidos, nombres con caracteres raros, URLs de imagen `javascript:` | Validación en cada RPC y restricciones en tablas |

Verificado con un atacante real (clave anónima, sin sesión): todas las llamadas devuelven `401 permission denied`
y el schema `archive` no existe para la API. Como jugador autenticado normal: 26 verificaciones de seguridad pasan.
El Security Advisor de Supabase informa **0 errores** (los avisos restantes son por diseño: las RPC del juego
deben poder llamarse y las tablas son legibles solo a través de RLS).

## 2. Matemática y consistencia

| # | Hallazgo | Corrección |
|---|---|---|
| M1 | `p_max_price` (tolerancia de slippage) llegaba al servidor y **se ignoraba** | Compra: se rechaza si el precio *promedio* supera tu máximo; venta: si baja de tu mínimo |
| M2 | Piscinas `numeric(12,2)` y saldo `numeric(10,2)`: **cada operación redondeaba a centavos**, el producto k = yes·no derivaba y la vista previa no coincidía con lo ejecutado | Piscinas a 10 decimales, dinero a 4, acciones a 6; vista previa idéntica al servidor (test de paridad 1e-6) |
| M3 | Costo promedio del portafolio con división por cero/NaN y calculado en el navegador descargando todas las transacciones | Cálculo en servidor (`get_my_portfolio`) |
| M4 | Gráfico de precios: `limit 100` ascendente → tras 100 operaciones solo mostraba las **primeras** | Muestreo uniforme que siempre incluye el último punto |
| M5 | Anular un mercado fallaba si el reembolso (negativo) dejaba el saldo < 0 | Se ajusta a 0 y se informa cuántos jugadores no pudieron devolver todo |
| M6 | Mensaje de slippage con formato inválido (`%.2f` en PL/pgSQL) | Mensajes claros |

Invariantes verificadas bajo carga: `YES(pool)+ΣYES = NO(pool)+ΣNO` (conservación de tokens), producto k constante,
saldo = 1000 − Σ inversiones + Σ pagos, movimientos usados = operaciones exitosas.

## 3. Concurrencia

| # | Hallazgo | Corrección |
|---|---|---|
| C1 | Saldo, acciones y límite diario se leían **sin bloqueo** antes de operar | Orden global de bloqueos mercado → perfil → acciones (sin deadlocks), `lock_timeout` de 6 s |
| C2 | Doble toque / reintento de red podía ejecutar la operación dos veces | `request_id` idempotente: el servidor devuelve el resultado guardado |
| C3 | Límite diario por fecha UTC en servidor y otra UTC en cliente | Día en **hora de Venezuela**, fuente única `get_daily_moves()` |
| C4 | Mercados múltiples creados con `update … where question = X` (no atómico; pisaba mercados con el mismo texto) | `admin_create_market_group` atómico |

## 4. Rendimiento y escalabilidad

| # | Hallazgo | Corrección |
|---|---|---|
| P1 | Cada evento Realtime obligaba a **todos** los clientes a descargar todos los perfiles, acciones y mercados (O(n²)); además la publicación no incluía ninguna tabla, así que nunca funcionaba | Sondeo adaptativo con jitter, backoff y pausa en segundo plano |
| P2 | Ranking: cada cliente descargaba todos los perfiles + acciones (con emails) | RPC en servidor |
| P3 | La misma lógica de trading duplicada en dos pantallas (~400 líneas) | `TradePanel` único + `lib/trading.js` |
| P4 | Cada pantalla volvía a descargar los mercados al montarse | Estado compartido (`GameContext`) |
| P5 | Service worker cacheaba respuestas autenticadas de la API | Eliminado (riesgo de saldos viejos / de otra cuenta) |
| P6 | Páginas de 20–40 KB, doble manifest, doble registro del SW, `terser` sin declarar, 404 al recargar `/market` | Páginas 3–5× más pequeñas; `vercel.json`; build limpio |
| P7 | Índices faltantes/duplicados | `shares(market_id)`, `transactions(market_id)`, `(user, market, side, fecha)`; duplicados eliminados |
| P8 | Auth: 30 registros/inicios de sesión por IP cada 5 min | 300 (varios familiares comparten IP) |
| P9 | El plan gratuito pausa el proyecto a los ~7 días | Keep-alive gratuito (GitHub Actions) |

## 5. Experiencia de usuario

Diálogos de confirmación propios (con el detalle de la orden) en lugar de `window.confirm`; atajos de monto
($10/$25/$50/$100, 25 %/50 %/75 %, Máx); errores en español claro; aviso de conexión; pantalla de error en lugar de
pantalla blanca; reintento si el perfil no carga; mostrar/ocultar contraseña; **Recuerdos** con las partidas anteriores;
registro de actividad del admin; "Nueva partida" con doble confirmación.

## 6. Pruebas

- `scripts/loadtest.mjs` — 100 verificaciones contra el backend real (seguridad como jugador, paridad de cálculo,
  idempotencia, slippage, resolución/anulación, Recuerdos y 5 escenarios de concurrencia).
- `tests/ui-*.test.jsx` — recorridos E2E de la interfaz real (React + jsdom): jugador (comprar, vender, portafolio,
  Trade, Recuerdos), alta de jugador nuevo y panel admin.
- Los usuarios de prueba son temporales (`@loadtest.invalid`) y se borran al terminar. Para recrearlos:

```sql
-- 14 usuarios: lt_00 (admin) … lt_13. Sustituye <PASSWORD>.
-- Desde la migración 015 hay que invitarlos primero (si no, la compuerta rechaza el alta):
insert into public.invited_emails (email_key, email, password_ok, note)
select 'lt_' || lpad(g::text, 2, '0') || '@loadtest.invalid', 'lt_' || lpad(g::text, 2, '0') || '@loadtest.invalid', true, 'prueba'
from generate_series(0, 13) g;
with ins as (
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
         'lt_' || lpad(g::text, 2, '0') || '@loadtest.invalid',
         extensions.crypt('<PASSWORD>', extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
  from generate_series(0, 13) g returning id, email
)
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text,
       jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now(), now(), now()
from ins;

update public.profiles set username = 'lt_user_' || substr(email, 4, 2), is_admin = (email = 'lt_00@loadtest.invalid')
where email like '%@loadtest.invalid';

-- Entre una ejecución y otra. ¡SOLO datos de prueba! El juego real puede estar en marcha (nunca borrar tablas enteras):
delete from public.markets where question like '[TEST%' or question like '[AUDIT]%'
   or created_by in (select id from public.profiles where email like '%@loadtest.invalid' or email like 'lt\_%@jugador.familymarket.invalid');
delete from public.transaction_logs where user_id in (select id from public.profiles where email like '%@loadtest.invalid' or email like 'lt\_%@jugador.familymarket.invalid');
delete from public.notifications where user_id in (select id from public.profiles where email like '%@loadtest.invalid' or email like 'lt\_%@jugador.familymarket.invalid');
delete from public.trade_requests where user_id in (select id from public.profiles where email like '%@loadtest.invalid' or email like 'lt\_%@jugador.familymarket.invalid');
delete from public.admin_actions where admin_id in (select id from public.profiles where email like '%@loadtest.invalid');
delete from public.help_requests where name like 'lt\_%'; delete from public.signup_attempts;
update public.profiles set balance = 1000, tour_completed_at = null, is_moderator = false where email like '%@loadtest.invalid';

-- Al terminar (cascada: perfiles, acciones, operaciones, instantáneas). Las pruebas de acceso y de alta también crean cuentas lt_acc_* / lt_signup_* / lt_n* / lt_d* / lt_s*:
delete from auth.users where email like '%@loadtest.invalid' or email like 'ltacc%+otra@gmail.com' or email like 'lt\_%@jugador.familymarket.invalid';
delete from public.invited_emails where email like '%@loadtest.invalid' or email like 'lt.acc%@gmail.com';
```


---

# Fase 2 · Roles, funciones nuevas y correcciones (octubre 2026)

## Errores corregidos

| Problema | Causa | Solución |
|---|---|---|
| Rechazos masivos «el precio cambió» cuando varios compran a la vez | Tolerancia por defecto de 3 % | Por defecto 5 % + botón **«Reintentar a XX¢»** de un toque (refresca el precio y reenvía) |
| La pantalla Trade saltaba al mercado más nuevo cuando el admin creaba uno | `selected` caía a `activeMarkets[0]` | Ahora cada mercado tiene su propia pantalla (`/m/:id`, `/g/:id`): nada salta |
| Ráfaga de inicios de sesión → «Request rate limit reached» | Límite de Auth por IP | Mensaje claro + reintento automático escalonado (hasta 4 intentos) |
| No había forma de recuperar una contraseña ni cambiar un nombre | — | El dueño puede restablecer contraseñas (cierra sus sesiones) y renombrar jugadores |
| Una resolución equivocada no se podía deshacer | — | `admin_reopen_market` (solo dueño): revierte los pagos, borra avisos de victoria/derrota y avisa a todos |
| Un despliegue podía recargar la app a mitad de una compra | PWA en `autoUpdate` + `skipWaiting` | PWA en modo `prompt`: banner «Hay una versión nueva» y se aplica solo al tocarlo |
| El sondeo repetía campos estáticos y mercados cerrados | `select` completo cada 12 s | `get_market_prices` ligero + descarga de textos/fotos una sola vez (`static_rev`) |
| `image_url` existía pero nunca se mostraba | — | Fotos reales con placeholder de color, carga diferida y WebP |
| **«Nueva partida» habría fallado** | `archive.markets` se creó con `LIKE public.markets` y `markets` ganó columnas | `archive.snapshot_current_game` con listas de columnas explícitas (migración 008); probado archivando y reiniciando en una transacción de prueba |

## Seguridad de lo nuevo

- Todo sigue entrando por RPC `SECURITY DEFINER`; las tablas nuevas (`notifications`, `market_suggestions`,
  `networth_snapshots`) no tienen privilegios para `anon` ni `authenticated`.
- Moderadores: `is_staff()` en servidor; las herramientas destructivas (anular, deshacer, saldos, nombres,
  contraseñas, reinicio, nombrar moderadores) exigen `is_admin()`. Probado que un moderador no puede usarlas.
- El filtro fantasma se aplica también a `get_market_prices`, `get_recent_activity`, perfiles y avisos.
- Fotos: bucket `market-images` público de lectura, escritura solo staff, solo `image/webp` y `image/jpeg`, 1 MB;
  el servidor solo acepta URLs que empiecen por la URL pública de ese bucket.
- Cierre por fecha: `buy_shares`/`sell_shares` rechazan operaciones después de `closes_at` usando la hora del servidor.

## Pruebas de esta fase

- `node scripts/loadtest.mjs feat`: 76 verificaciones (roles, cierre por fecha, avisos, deshacer resolución,
  sugerencias, visibilidad del filtro fantasma, grupos, carrera de patrimonio, perfiles, almacenamiento).
- `sec` (35), `func` (57) y `conc` (17) actualizadas al nuevo esquema: todas en verde.
- `npm run test:ui`: 3 recorridos E2E (jugador, dueño, alta) en verde.
- Benchmark en la base: 1,35 ms por compra (150 compras seguidas), igual que antes de las funciones nuevas.


---

# Fase 3 · Tutorial por rol, calibración, auditoría de cálculos y acceso por invitación (octubre 2026)

## Tutorial por rol
Jugador: 7 misiones. Moderador: las mismas + misión de moderación (8). Dueño: no recibe tutorial automático (puede repetir el de jugador desde
Portafolio). Prueba: `tests/ui-tour-roles.test.jsx` (modo demo, cubre los tres roles y recorre el del moderador completo).

## Calibración de la liquidez (el «1200»)
`scripts/calibrate.mjs` simula jugadores con creencias propias (ruidosas) con la MISMA matemática del servidor. Para 40 jugadores, 400 mercados por celda:

| Liquidez L | Salto medio por operación | Salto p95 | Salto máximo | $100 mueve | 40 jugadores × $100 en «Sí» | Dinero que el mercado crea/destruye por mercado (p5 … p95) | Regalo máximo |
|---|---|---|---|---|---|---|---|
| 600 | 6.4 pp | 18.0 | 41.2 | ~7.5 pp | 98.3 % | −1.3 % … +0.4 % | $600 |
| **1200 (antes)** | 3.1 pp | 8.5 | 22.6 | ~3.9 pp | 94.8 % | −1.8 % … +1.1 % | $1200 |
| **2000 (ahora)** | **1.8 pp** | **5.1** | **12.4** | **~2.4 pp** | **89.8 %** | **−2.6 % … +2.0 %** | $2000 |
| 3000 | 1.2 pp | 3.4 | 6.5 | ~1.6 pp | 84.2 % | −3.7 % … +3.2 % | $3000 |
| 5000 | 0.7 pp | 2.1 | 4.0 | ~1.0 pp | 76.1 % | −5.8 % … +5.6 % | $5000 |

Criterio: que una apuesta normal ($50–100) mueva el precio ~1–2.5 puntos (no ~4 como con 1200), que un consenso casi total de 40 jugadores llegue a ~90 %
(todavía se expresa, sin chocar con el tope de 99 ¢) y que cada mercado cree o destruya poco dinero respecto de los $40,000 que circulan. Con L = 5000 el
precio casi no se mueve (nadie llega a 80 %); con L = 600 es nervioso. **Se eligió 2000** (migración 013; solo afecta mercados NUEVOS, los
existentes conservan sus piscinas). Para menos de ~15 jugadores conviene bajarlo a ~1200 (`update public.game_settings set initial_liquidity = 1200;`).
Ida y vuelta (comprar y vender enseguida) cuesta solo las comisiones (≈ 3.96 %), no depende de L.

## Auditoría de cálculos (`scripts/audit.mjs`)
12 jugadores hacen ~450 compras y ventas aleatorias (de $0.01 a $400, ventas parciales y totales) contra el servidor real, con semilla reproducible.
Resultado: **3374 verificaciones correctas, 0 fallos** (varias semillas). Lo que se comprueba:

1. Paridad servidor ↔ frontend (acciones, comisión, precio medio, precio final, piscinas, saldo): error máximo de acciones 0 (±1e-6 permitido).
2. Invariantes: k = yes·no constante (deriva 3e-13); acciones SÍ y NO conservadas; precio dentro de [1 ¢, 99 ¢]; sin ida-y-vuelta rentable.
3. Libro contable: saldo = $1000 + ventas − compras (+ pagos) para cada jugador; movimientos diarios usados = operaciones hechas.
4. Ranking: patrimonio = efectivo + Σ acciones × precio; orden y posiciones; costo promedio del portafolio recalculado de forma independiente.
5. Resolución: $1.00 exacto por acción ganadora; avisos con ganancia = pago − invertido; estadísticas del perfil (aciertos, fallos, ganancia realizada);
   identidad contable **Σ ganancia de jugadores = L − piscina_ganadora − comisiones**; el mercado nunca regala más que L.
6. Deshacer resolución, volver a resolver y anular devuelven el dinero exacto; no se opera en mercados resueltos.
7. Extremos: compra mínima ($0.01), tope de 99 ¢ (aceptado justo debajo, rechazado justo encima), venta que rompería 1 ¢, vender más de lo que se tiene,
   `request_id` repetido cobra una sola vez.

### Hallazgo corregido: mercados de varias opciones regalaban dinero (migración 014)
Cada opción nacía al 50 %. En un mercado de N ≥ 3 opciones (gana UNA o ninguna) la suma de «Sí» era N/2 > 100 % y **comprar «No» en todas las opciones era
ganancia segura** (costaba ~N/2 y pagaba al menos N−1), pagada por la liquidez inicial. Ahora cada opción nace con probabilidad 1/N (suma = 100 %), con el
mismo k = L². Probado: suma de «Sí» = 100 % en grupos de 2, 3, 4 y 7 opciones, y el peor caso de «No en todas» paga menos de lo invertido.

### Revisado sin hallazgos
Orden de bloqueos (mercado → perfil → acciones: sin ciclos posibles), idempotencia, día de juego en hora de Venezuela (`America/Caracas`, sin horario de
verano), redondeos (dinero a 4 decimales, acciones a 6: error máximo por operación < 1e-4), crecimiento de tablas con 40 jugadores (≈ 2,400 operaciones/día).

## Acceso por invitación (migración 015)
Ver README → «Cómo entra la gente». Pruebas: `loadtest.mjs access` (13 verificaciones contra el Auth real: desconocido rechazado, invitado «solo Google»
rechazado con contraseña, con permiso de contraseña sí, Gmail con otros puntos reconocido, perfil nace con $1000 sin nombre ni permisos), seguridad
(jugador normal no puede usar las RPC de invitaciones ni leer la tabla), `tests/ui-auth.test.jsx` (Google, error de «no invitado», aviso de visor interno,
panel de invitaciones) y `tests/ui-onboarding.test.jsx` (alta real: rechazado sin invitación, aceptado tras invitar).


## Moderadores: solo lo que ellos crearon (migración 016)
`resolve_market` y `staff_update_market` (editar y cerrar apuestas con `closes_at`) rechazan a un moderador sobre un mercado que no creó
(«Solo puedes resolver / editar o cerrar los mercados que tú creaste»). Resolver también cierra el mercado, por eso la regla cubre las dos. Los
grupos se crean completos con el mismo autor, así que valen igual. El dueño no tiene restricción. En el panel, un moderador ve solo sus mercados
(Hoy, Mercados, insignia de pendientes) y los atajos «Solo tú ves esto» salen solo en los suyos. Pruebas: `loadtest.mjs` sección «MODERADOR»
(10 verificaciones: rechazos sobre mercados y grupos del dueño, mercado intacto, éxito sobre los propios) y `tests/ui-mod-own.test.jsx`.

## Horas en orden real de ejecución (migración 017)
Una prueba de concurrencia («el admin resuelve mientras 6 jugadores compran y venden») falló una vez por culpa de una prueba que comparaba horas del
CLIENTE (con la latencia de red de un VPN una respuesta puede llegar tarde aunque la operación se haya ejecutado antes de resolver). Revisándola se vio
un detalle real: `now()` guarda la hora en que EMPEZÓ la transacción, no la de cuando consiguió el candado del mercado, así que una operación podía quedar
registrada con una hora unos milisegundos «posterior» a la resolución, o dos operaciones del mismo mercado en orden cambiado en el historial de
precios. El dinero nunca estuvo en riesgo (todo se serializa por el candado del mercado y la prueba de saldos exactos pasó siempre), pero se corrigió:
`created_at` de `transactions`, `transaction_logs` y `market_prices_history` y `resolved_at` usan `clock_timestamp()` (hora real al insertar, ya con el
candado tomado). La prueba ahora verifica en el servidor que ninguna compra/venta tiene hora posterior a `resolved_at`.

## Ensayo con 40 jugadores simultáneos (`scripts/simulate.mjs`)
40 cuentas sondeando precios, ranking y movimientos como la app real, operando cada ~35 s, una «estampida» (40 compras en ~3 s sobre un mercado nuevo) y
una resolución en medio. Resultado en el servidor (registros de Supabase de esa ventana): **2,065 peticiones a la API, 2,064 con 200 y 1 con 400 (un rechazo
esperado por cambio de precio), 0 errores 5xx, 0 errores de base de datos, 0 bloqueos mutuos**; tiempo de proceso en el servidor 8 ms de media (compra 15 ms;
el mayor valor aislado fue ~0.5 s). Las latencias de varios segundos que reporta el script son de la red del equipo de pruebas (salía por un VPN), no del
servidor. Después de la carga, comprobación directa en SQL: todos los mercados conservan k = yes·no (error 1e-13), las acciones se conservan (error de
redondeo 2e-6, descontando el arranque desigual de los mercados de varias opciones), el saldo de las 41 cuentas coincide con su libro de operaciones
(diferencia 0.0000), sin saldos ni acciones negativos y con tantas filas de `transactions` como de `transaction_logs`.


## Registro por código de la familia (migraciones 018 y 019)
Reemplaza a «pedir correos»: link + código + nombre + contraseña, todo desde el celular (ver README → «Cómo entra la gente»). Pruebas:
`loadtest.mjs access` (37 verificaciones contra el Auth real: sin código / código malo / nombre repetido / correo externo rechazados; con el código correcto la cuenta se crea,
entra de una vez, nace con su nombre y $1000 y reaparece al iniciar sesión; registro cerrado y cupo lleno bloquean; la configuración real se restaura al terminar;
`LOADTEST_ROTATE=1` además prueba cambiar el código), bloqueo por 200 intentos fallidos (comprobado en SQL con reversión), `tests/ui-auth.test.jsx` (pantalla, link con
código, tarjeta del dueño) y `tests/ui-onboarding.test.jsx` (alta real completa con tutorial y reingreso por nombre de usuario).

**Hallazgo corregido (019):** el proyecto tiene `pg_safeupdate`, que rechaza `UPDATE` sin `WHERE` para las funciones llamadas por la API. Las dos funciones del dueño que cambiaban la fila
única de `signup_config` fallaban en producción con «UPDATE requires a WHERE clause»; las pruebas contra el servidor real lo detectaron (la prueba en modo demo no podía) y ahora llevan `where id`.


# Fase 4 · Recuperar cuentas, deshabilitar jugadores, apertura programada y premio por mercado sorpresa (octubre 2026)

## Recuperar el acceso (migración 020)
Revisión del restablecer contraseña: a nivel de servidor funcionaba (la contraseña nueva entra, la vieja no, se cierran las sesiones), pero en la práctica fallaba por dos
motivos reales: (1) los jugadores antiguos solo entraban con su **correo**, y al olvidarlo tampoco les servía su usuario; (2) quien no podía entrar **creaba otra cuenta**.
Ahora: «Pedir ayuda» sin cuenta → el dueño restablece con un toque (la cuenta pasa a entrar con su **nombre de usuario**) y copia el mensaje; la persona cambia la contraseña
temporal por la suya en Portafolio → Mi cuenta; y al registrarse se avisa de nombres parecidos. Pruebas: `loadtest.mjs accounts` (restablecer con conversión, entrada por usuario,
sesión que ya no se renueva, contraseña propia, ayuda y deduplicación, nombres parecidos con y sin código), `tests/ui-accounts.test.jsx`.

## Deshabilitar y eliminar jugadores
Deshabilitado = fuera del ranking, la carrera, el perfil y la actividad; no puede entrar (bloqueo de la cuenta) **ni operar con la sesión que ya tenía** (comprar/vender lo rechazan);
su nombre queda libre (`Nombre_off`) para que la persona se registre de nuevo; sus acciones en mercados abiertos se conservan; reversible. Eliminar definitivamente exige haberlo deshabilitado antes.
No se puede deshabilitar ni eliminar al dueño. Pruebas en `loadtest.mjs accounts` (14 verificaciones sobre ranking, carrera, actividad, sesión abierta, login, cupo, nombre libre, rehabilitar con
nombre ocupado/libre y eliminar).

## Apertura programada (migración 021)
`markets.opens_at` (nulo = se abre al crearse). Antes de la hora: `buy_shares`/`sell_shares` rechazan con «Este mercado todavía no abre» (se compara con `clock_timestamp()` ya con el candado tomado),
`get_market_prices` entrega la hora para mostrar «Abre en…», y se puede reprogramar / abrir ya mientras no haya operaciones. Validaciones: apertura antes del cierre; una apertura en el pasado o en los
próximos 30 s significa «abrir ya». Los mercados de varias opciones se programan completos. Pruebas: `loadtest.mjs schedule` (18) y la interfaz en `tests/ui-accounts.test.jsx`.

## Premio por mercado sorpresa (migración 022) — cómo se eligió el porcentaje
Simulación del volumen apostado por mercado (`scripts/calibrate.mjs`, jugadores con creencias propias, 300 mercados por celda; liquidez 2000):

| Estilo de juego | 10 jugadores | 20 jugadores | 40 jugadores |
|---|---|---|---|
| relajado (apuestas de $5-40) | $466 | $882 | $1,604 |
| normal ($10-100) | $1,387 | $2,626 | $5,037 |
| intenso ($20-300) | $3,424 | $6,758 | $13,261 |

Con un mercado sorpresa típico (volumen de ~$900 a ~$5,000) el **2 %** da **$18 a $100**; el tope de **$40** lo limita a ≈ 4 % del saldo inicial por persona y por mercado.
Razones de «2 %, bolsa repartida, tope $40»: (a) 2 % = la comisión del juego, así la bolsa equivale a las comisiones que se quemaron en ese mercado y **no crea dinero nuevo** cuando las posiciones
se mantienen hasta resolver; (b) repartida entre las personas ocultas evita que ocultar a muchos dispare la inflación; (c) el tope evita que un mercado enorme regale demasiado a quien no jugó;
(d) quien no participa evita pagar comisiones y perder, así que el premio es un gesto, no un sueldo. Alternativas ajustables sin tocar código (Admin → Más): 1 % (más discreto), 3 % (más generoso), o
modo «cada una» (cada persona oculta cobra el porcentaje completo).
Pruebas: `loadtest.mjs reward` (27): reparto entre 2 y 1 persona, modo «cada una», tope, sin apuestas y porcentaje 0 no pagan, el dueño no cobra, el aviso trae la apuesta oculta (migración 023), no cuenta como
acierto, deshacer la resolución y anular el mercado lo devuelven en silencio, y la configuración real se restaura.


# Fase 5 · Aviso animado del premio sorpresa y revisión en iPhone / Android (octubre 2026)

## Aviso del premio (migración 023)
Al resolverse un mercado sorpresa, quien no pudo participar recibe una tarjeta animada (regalo, lluvia de monedas, confeti, cifra que sube, vibración y sonido opcionales) con **la apuesta que le ocultaron**
(pregunta), el resultado, el dinero total que se movió y cómo se repartió la bolsa. Antes de resolver no hay aviso ni rastro del mercado. Verificado en el servidor real con transacciones que se deshacen
(sin dejar datos): 2 ocultos (3.5 c/u), 1 oculto (7), modo «cada una», tope, sin apuestas = sin premio, el dueño no cobra, el oculto no ve el mercado ni recibe aviso de ganar/perder, deshacer la
resolución y anular lo devuelven en silencio y re-resolver paga una sola vez. UI: `tests/ui-accounts.test.jsx` (tarjeta con pregunta, resultado, +$20.00 animado y cierre). Vista previa:
`npm run dev` → `/?mock=1&role=player&reward=1`.

## iPhone y Android
Chrome emulando 7 pantallas (iPhone SE 1.ª gen 320 px, iPhone SE 375, iPhone 15, iPhone Pro Max, Android 360×640 y 360×800, Pixel 8) con agente de usuario de Safari iOS y de Chrome Android, 16 pantallas
cada una (acceso, registro, inicio, mercado, grupo, ranking, portafolio, sugerir, recuerdos, tutorial, aviso del premio y las 5 pestañas del panel): **sin desbordes horizontales, sin campos con letra < 16 px
(iOS no hace zoom al escribir), sin errores de consola**; botones de texto pequeños agrandados a ≥ 44 px donde importa (pantalla de acceso, ayuda, saltar tutorial, filas de opciones). Flujo táctil real
(toques, teclado) en 3 pantallas: abrir hoja de compra, escribir monto, comprar (el saldo baja) y cerrar el aviso del premio: 36/36. Compatibilidad estática: el JS y el CSS compilados pasan `esbuild
--target=safari14,chrome80`; no hay APIs sin respaldo (WebP→JPEG en Safari, portapapeles con alternativa, `randomUUID` con alternativa, `vibrate` y `AudioContext` con respaldo, `100dvh` con alternativa,
`safe-area-inset`, `viewport-fit=cover`, iconos `apple-touch-icon`, manifest PWA). Límite honesto: se probó con Chrome emulando teléfonos, no con un iPhone físico (Safari de verdad usa otro motor);
por eso se verificó además la sintaxis y las APIs contra Safari 14.


# Fase 6 · Moderadores con decisión final y gráficas que fluyen (octubre 2026, con el juego ya en marcha)

## Moderadores: cerrar y resolver cualquier mercado (migración 024)
Pedido del dueño: un moderador puede **cerrar las apuestas y tomar la decisión final de cualquier mercado**. Servidor: `resolve_market` ya no exige haberlo creado; `staff_update_market` deja a un moderador ajeno
**solo** poner `closes_at` ya (o en ≤ 2 minutos): no puede alargar el cierre (sería reabrirlo), ni cambiar texto/foto/categoría/apertura, ni mezclar cambios. Editar sigue siendo del creador y del dueño; deshacer una
resolución y anular siguen siendo solo del dueño; un jugador normal no puede nada de esto. Interfaz: `useManage` separa `canManage` (cerrar y resolver: todo el staff) de `canEdit` (editar y «Abrir ya»: dueño y creador);
la barra de atajos, Hoy y Mercados muestran todo al moderador y le explican «lo creó otra persona: puedes cerrar y decidir el resultado, pero no editarlo».
Verificado en el servidor real SIN dejar datos (transacción que se deshace): el moderador no edita, no alarga, no mezcla y no toca la apertura de un mercado ajeno; sí lo cierra (nadie más compra), sí lo resuelve y el pago
y el aviso llegan; no deshace ni anula; edita lo suyo; el dueño deshace; un jugador normal no cierra ni resuelve. UI: `tests/ui-mod-own.test.jsx` (5).

## Gráficas: causa del problema al cambiar de filtro y arreglo
**Causa real:** `usePolling` solo ejecutaba la carga al montar y cada N segundos; al cambiar el rango (1H/6H/1D/Todo) la función cambiaba pero **nadie volvía a pedir el dato hasta el siguiente refresco** (25 s en
mercados, 45 s en la carrera): el gráfico quedaba en esqueleto o con el rango anterior; además una respuesta vieja que llegaba tarde podía pisar a la nueva y un fallo dejaba el esqueleto para siempre. Además, la carrera de
patrimonio no tenía punto de anclaje (un rango sin operaciones salía vacío) y las marcas del eje eran del tipo 10:37 · 11:07.
**Arreglo:** hook `useSeries` (pide al instante al cambiar la clave, la última petición gana, conserva el dato anterior atenuado con «Cargando…», error con «Reintentar»), `usePolling` con `immediate:false`,
ejes de tiempo en horas redondas locales (`timeAxis`) y de dinero con marcas redondas (`moneyScale`, `axisMoney`), la línea se extiende hasta «ahora» o hasta el final de la ventana, y la carrera de patrimonio ahora
también trae el punto de anclaje por jugador. Altura fija (sin saltos). Aplicado a las 4 gráficas: mercado, mercado múltiple, carrera de patrimonio y portafolio.
Pruebas: `tests/charts.test.jsx` (7: carga inmediata al cambiar de filtro, dato anterior conservado, respuesta vieja ignorada, error y reintento, ejes) y recorrido táctil en Chrome emulando iPhone SE y Pixel 8
en 4 pantallas × 6 cambios de filtro + cambios rápidos seguidos: 66/66, cada rango se dibuja en ~0.2 s sin errores de consola.

## Portafolio de cada jugador (nuevo)
`get_player_networth(p_user_id, p_since, p_max_points)` (solo jugadores activos, con punto de anclaje) y el componente `PortfolioChart`: total (efectivo + apuestas) en el tiempo, línea de efectivo, línea punteada del
dinero inicial, cuánto subió o bajó en el rango y tooltip con total / efectivo / en apuestas. Aparece en **Portafolio → «Mi portafolio»** y en el **perfil de cada jugador** (Ranking → tocar un jugador).


# Fase 7 · +15 % de volatilidad (octubre 2026, con el juego en marcha)

**Pedido:** que cada mercado sea 15 % más volátil, los nuevos y los ya creados.
**Cómo se logra:** en el mercado CPMM el movimiento del precio por dólar es inversamente proporcional a la liquidez («profundidad» = raíz de yes_pool × no_pool). Dividir la liquidez entre **1.15** (no multiplicar por 0.85, que daría
+17.4 %) da +15 %: con `trading.js` se midió que el mismo dinero mueve el precio ×1.150 (compras de $5–25), ×1.148 ($50), ×1.146 ($100) y ×1.141 ($200), en mercados nuevos y en los ya empezados (67 %, 49 %, 85 %).
- **Mercados nuevos:** `game_settings.initial_liquidity` 2000 → **1739.13** (y su valor por defecto); también los mercados de varias opciones (nacen a 1/N con la profundidad nueva).
- **Mercados ya creados y abiertos:** `yes_pool` y `no_pool` ÷ 1.15. Se escalan las dos piscinas por igual, así que **el precio no cambia, ni el valor de las posiciones, ni el patrimonio de nadie**; solo cambia cuánto se mueve el precio
  con las siguientes operaciones. Los mercados ya resueltos no se tocan (conservan su historial exacto). Migración 025 (idempotente: solo actúa si la liquidez todavía vale 2000).
**Verificación en el servidor real SIN dejar datos** (transacción que se deshace): diferencia máxima de precio entre antes y después = 0; diferencia máxima de patrimonio de los jugadores = 0; un mercado nuevo nace con 1739.13/1739.13 y
una compra de $50 mueve 1.2100¢ antes y 1.3889¢ después (×1.148); un grupo nuevo nace a 1/3 con profundidad 1739.13; el titular de la posición abierta más grande (651.56 acciones) puede venderla entera (cobra $401.50).
Después de aplicarla en producción: los 2 mercados abiertos pasaron a profundidad 1739.13 con los mismos precios (66.99 % y 48.86 %), los 6 resueltos siguen en 2000.00, y los saldos y operaciones no cambiaron.
**Si se quiere ajustar de nuevo:** `update public.game_settings set initial_liquidity = X where id;` solo afecta mercados NUEVOS; para uno ya abierto hay que escalar sus dos piscinas por el mismo factor (nunca una sola).
