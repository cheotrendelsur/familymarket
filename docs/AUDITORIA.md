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

-- Al terminar (cascada: perfiles, acciones, operaciones):
delete from auth.users where email like '%@loadtest.invalid';
```
