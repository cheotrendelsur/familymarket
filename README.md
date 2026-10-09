# FamilyMarket 🎯

Mercado de predicciones familiar (dinero imaginario), con el aire de Polymarket. Cada jugador empieza con **$1,000**
y compra/vende acciones **Sí / No** de eventos futuros ("¿Lloverá mañana?", "¿Quién come más?"). El dueño o un
moderador resuelve cada mercado y los ganadores cobran **$1 por acción**. Gana quien termine con más patrimonio.

- **App en producción:** https://familymarket-rho.vercel.app (Vercel, se despliega solo al hacer push a `main`)
- **Base de datos:** Supabase, proyecto `tbxwqxuandxibpwoshuc` (cuenta `chechechristiansen@gmail.com`)
- **Costo:** $0 (Vercel Hobby + Supabase Free + GitHub Actions)

## Cómo se juega

| Regla | Valor |
|---|---|
| Saldo inicial | $1,000 |
| Liquidez inicial de cada mercado | 1200 YES / 1200 NO (precio inicial 50¢) |
| Comisión (fee) | 2 % en cada compra y venta |
| Límite de movimientos | 60 por día (el día cambia a medianoche **hora de Venezuela**) |
| Precio mínimo / máximo | 1¢ – 99¢ |
| Pago al resolver | $1.00 por acción ganadora |
| Tolerancia de precio | 5 % por defecto (ajustable); si otro jugador mueve el precio, un toque reintenta al precio nuevo |
| Mercados múltiples | Varias opciones bajo un mismo tema (se crean juntas, de forma atómica; comparten foto y cierre) |
| Cierre por fecha | Un mercado puede tener hora de cierre: cuenta regresiva, apuestas bloqueadas en el servidor y estado «esperando resultado» |
| Filtro fantasma | Se puede **ocultar** un mercado a ciertos jugadores (sorpresas); se aplica en el servidor también al feed y a los perfiles |
| Fotos | Cámara o galería; se recortan y comprimen en el celular (WebP, JPEG en Safari) antes de subirse al bucket público `market-images` |
| Sugerencias | Cualquier jugador propone mercados (máx. 3 pendientes); el dueño y los moderadores aprueban o rechazan |
| Recuerdos | Pestaña con las partidas anteriores: ranking final, mercados, portafolio y operaciones de cada jugador |

### Roles

| Rol | Puede |
|---|---|
| **Dueño** (`is_admin`) | Todo: crear/editar/resolver/anular mercados, **deshacer una resolución**, nombrar moderadores, cambiar nombres, restablecer contraseñas, ajustar saldos, empezar una partida nueva |
| **Moderador** (`is_moderator`) | Crear, editar y resolver mercados, subir fotos, revisar sugerencias y ver el registro de actividad |
| **Jugador** | Operar, sugerir mercados, ver ranking, perfiles y feed en vivo |

El dueño nombra moderadores desde **Admin → Gente** (un interruptor en la fila de cada jugador).

### Panel de administración (dueño y moderadores)

Pensado para operarlo con el pulgar:

- **Hoy:** solo lo pendiente. «Por resolver» (mercados que ya cerraron apuestas) con botones grandes **Gana Sí / Gana No**
  (en los múltiples: «Gana este» en cada opción), «Sugerencias nuevas» con **Publicar** de un toque (o Editar / No) y los que cierran
  en 24 h con «Cerrar ya». La insignia roja de la pestaña Admin cuenta lo que espera.
- **Crear:** pregunta, foto (cámara o galería), atajos de cierre («En 2 horas», «Hoy 8 pm», «Mañana»…) y categoría. Descripción y
  mercado sorpresa están en «Más opciones».
- **Mercados:** lista por estado; resolver con un toque y el menú «⋯» (editar, cerrar apuestas, anular, deshacer resolución).
- **Gente** (solo dueño): interruptor de moderador por jugador, nombre, contraseña y saldo.
- **Más:** registro de actividad, sugerencias ya revisadas y «Empezar una partida nueva» (solo dueño).
- **Atajos en la app:** al abrir cualquier mercado, el staff ve un recuadro «Solo tú ves esto» para resolverlo, cerrarlo o editarlo
  ahí mismo, y en Inicio hay un botón flotante **Crear**.

Los valores numéricos (fee, límite diario, liquidez, saldo inicial, zona horaria) viven en la tabla
`public.game_settings` (una fila). Para cambiarlos, en el SQL Editor de Supabase:

```sql
update public.game_settings set daily_limit = 80, fee_rate = 0.015;
```

## Empezar una partida nueva

1. Entra como dueño → pestaña **Admin** → **Nueva partida**.
2. (Opcional) escribe un título para el recuerdo, por ejemplo "FamilyMarket · Viaje a Margarita".
3. Escribe `REINICIAR` y pulsa **Archivar y reiniciar partida**.

Esto guarda una copia completa de la partida actual en **Recuerdos** (jugadores, mercados, acciones, operaciones
e historial de precios) y luego deja a todos en $1,000 sin mercados. **Las cuentas y nombres de usuario se
conservan** (y los moderadores). La partida de febrero 2026 ya está archivada como *"FamilyMarket · Febrero 2026"*.

## Arquitectura

```
React 18 + Vite + Tailwind (PWA)  ──HTTPS──▶  Supabase (Postgres + Auth + PostgREST)
        │                                          │
        │  lecturas: tablas con RLS                 │  escrituras: SOLO por funciones RPC (SECURITY DEFINER)
        └─ sondeo (polling) con jitter/backoff      └─ bloqueos mercado → perfil, idempotencia, límites
```

- **Sin Realtime a propósito:** con sondeo (12 s, 25 s si hay calma, pausado en segundo plano) el costo por
  usuario es constante y no hay límite de conexiones simultáneas del plan gratuito.
- **Una sola implementación de la matemática** (`src/lib/trading.js`) que replica exactamente las funciones SQL;
  una prueba verifica que la vista previa del frontend y el resultado del servidor coinciden al 1e-6.
- **Sondeo en dos niveles** (`GameContext`): `get_market_prices` (ligero, solo piscinas/estado) cada ~12 s; textos, fotos y
  categoría se descargan una sola vez y solo se vuelven a bajar si el servidor avisa (`static_rev`). `get_session_state`
  (cada ~15 s) trae movimientos del día, hora del servidor y avisos pendientes (victoria, derrota, sugerencias...).
- **Hora del servidor:** la cuenta regresiva usa la hora de la base de datos, no la del celular.
- **Celebraciones:** los avisos viven en la tabla `notifications`; la app los muestra uno a uno (confeti, vibración y
  sonido opcional) y los marca como vistos al cerrarlos.
- **Fotos:** `src/lib/images.js` recorta (banner 16:9 + miniatura cuadrada), codifica WebP y calcula el color promedio
  para el «placeholder». Solo el staff puede escribir en el bucket; el servidor solo acepta URLs de ese bucket.
- **Modo demo (solo desarrollo):** `npm run dev` y abre `http://localhost:5173/?mock=1&role=owner|mod|player` para ver la
  interfaz con datos de ejemplo, sin tocar la base real (`src/mock`, no entra al build de producción). En la consola:
  `__mock.win()`, `__mock.lose()`, `__mock.resolve('rain')`…
- **PWA:** al desplegar, la app instalada muestra «Hay una versión nueva» y se actualiza solo cuando el jugador toca el
  botón (nunca recarga a mitad de una compra).
- **Seguridad por capas:** ningún rol de la API puede escribir tablas; todo pasa por RPC que validan identidad,
  rol admin, mercado abierto, saldo, límites y slippage.

### Estructura del repo

```
src/                  App (pages, components, context, hooks, lib)
supabase/migrations/  Esquema completo versionado (001…011). Aplicar en orden en el SQL Editor.
scripts/              loadtest.mjs (seguridad+lógica+concurrencia), latency.mjs, throughput.mjs
tests/                Pruebas E2E de interfaz (vitest + jsdom contra el backend real)
.github/workflows/    keepalive.yml (evita que Supabase pause el proyecto gratuito)
docs/AUDITORIA.md     Informe de auditoría: bugs y vulnerabilidades encontrados y corregidos
```

### Migraciones (`supabase/migrations`)

| # | Qué hace |
|---|---|
| 001 | Archivo privado `archive.*` ("Recuerdos") + RPC de lectura + snapshot de la partida de febrero |
| 002 | **Seguridad** (RLS/privilegios) + motor de compra/venta/resolución/anulación reescrito |
| 003 | Ranking, portafolio, historial de precios, movimientos diarios, "archivar y reiniciar" |
| 004 | Precisión numérica (piscinas a 10 decimales, dinero a 4) |
| 005 | Superficie mínima, `ping()` de keep-alive, RPC de auditoría admin |
| 006 | Roles (moderadores), categorías, cierre por fecha, fotos (columnas), creación/edición de mercados para staff, herramientas del dueño |
| 007 | Avisos (`notifications`), sugerencias, carrera de patrimonio (snapshots), `get_session_state`, `get_market_prices`, feed en vivo, deshacer resolución, motor con cierre por fecha |
| 008 | `get_networth_race`, `get_player_profile` (estadísticas), arreglo del archivado (columnas explícitas) |
| 009 | Bucket de fotos `market-images` (lectura pública, escritura solo staff) |
| 010 | Editar la descripción de un mercado múltiple la cambia en todas sus opciones |
| 011 | El staff puede ver (y así borrar) objetos del bucket de fotos |

## Desarrollo

```bash
npm install
cp .env.example .env.local     # VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev                    # http://localhost:5173
npm run build                  # build de producción (PWA)
```

### Pruebas

Requieren usuarios de prueba temporales (`lt_00@loadtest.invalid` dueño, `lt_01…lt_13`, con `username = lt_user_NN`) y un
archivo de credenciales **fuera del repo** (`{"password":"…","prefix":"lt_","domain":"loadtest.invalid","count":14}`):

```bash
LOADTEST_ENV=/ruta/testenv.json npm run test:load     # ~190 verificaciones: seguridad, lógica, roles, sugerencias, avisos, fotos, concurrencia
LOADTEST_ENV=/ruta/testenv.json npm run test:ui       # 3 recorridos E2E de la interfaz real (jugador, dueño, alta)
node scripts/loadtest.mjs feat                         # solo las funciones nuevas (roles, cierre, avisos, sugerencias, fotos)
```

Crear / borrar los usuarios de prueba (SQL Editor, ver `docs/AUDITORIA.md` §Pruebas):
`insert into auth.users …` / `delete from auth.users where email like '%@loadtest.invalid'`.

## Capacidad medida (plan gratuito, Nano)

| Prueba | Resultado |
|---|---|
| 150 compras simultáneas en UN mercado (10 jugadores) | Todas correctas; tokens, producto k, dinero y límite diario conservados |
| 100 compras simultáneas de un solo usuario | Exactamente 60 ejecutadas (límite diario), 40 rechazadas; nunca 61 |
| Doble gasto ($1000, 25 compras de $100 a la vez) | Exactamente 10; saldo final exacto 0 |
| 20 envíos con el mismo `request_id` | Una sola ejecución, un solo cobro |
| Resolver mientras 6 jugadores operan sin parar | Ninguna operación posterior al cierre; dinero conservado |
| Tiempo de base de datos por operación | **1,3 ms** (≈ 770 ops/s por mercado) |
| Rendimiento por la API desde una sola IP | hasta ~105 ops/s en un mercado (límite = red del cliente, no el servidor) |

Límites del plan gratuito a vigilar: 500 MB de base de datos (uso actual: unos pocos MB), 5 GB de transferencia al
mes (el sondeo adaptativo consume ~1 GB por viaje de 25 personas), 50 000 usuarios activos. Si algún día se
quedara corto, Supabase Pro ($25/mes) elimina estos topes sin cambiar el código.

## Operación y mantenimiento

- **Pausa por inactividad:** el plan gratuito pausa el proyecto tras ~7 días sin uso. El workflow
  `keepalive.yml` lo despierta cada 2 días. Si alguna vez se pausa: Supabase → *Restore project*.
- **Backups:** cada "Nueva partida" archiva todo en `archive.*` (privado). El archivo se lee solo por RPC.
  Para un respaldo externo: Supabase → Table Editor → *Export* (CSV), o `pg_dump` con la contraseña de la BD.
- **Límite de registros por IP:** Auth permite 300 registros/inicios de sesión cada 5 min por IP
  (antes 30; se subió porque varios familiares pueden compartir la misma IP del hotel u operadora).
- **Registro de actividad:** pestaña Admin → Actividad (visible para dueño y moderadores).
- **Olvidó la contraseña:** el dueño entra en Admin → Jugadores → el jugador → *Contraseña*: se genera una nueva y se
  la pasa por WhatsApp (se cierran las sesiones abiertas de ese jugador).
- **Auth → URL Configuration:** *Site URL* debe ser `https://familymarket-rho.vercel.app` (no `localhost`).
- **PWA instalada antes de esta versión:** la primera vez puede pedir cerrar y volver a abrir; desde ahora avisa con un
  banner «Hay una versión nueva».
