# FamilyMarket 🎯

Mercado de predicciones familiar (dinero imaginario). Cada jugador empieza con **$1,000** y compra/vende
acciones **YES / NO** de eventos futuros ("¿Lloverá mañana?", "¿Quién come más?"). El admin resuelve cada
mercado y los ganadores cobran **$1 por acción**. Gana quien termine con más patrimonio.

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
| Mercados múltiples | Varias opciones bajo un mismo tópico (se crean juntas, de forma atómica) |
| Filtro fantasma | El admin puede **ocultar** un mercado a ciertos jugadores (se aplica en el servidor) |
| Recuerdos | Pestaña con las partidas anteriores: ranking final, mercados, portafolio y operaciones de cada jugador |

Los valores numéricos (fee, límite diario, liquidez, saldo inicial, zona horaria) viven en la tabla
`public.game_settings` (una fila). Para cambiarlos, en el SQL Editor de Supabase:

```sql
update public.game_settings set daily_limit = 80, fee_rate = 0.015;
```

## Empezar una partida nueva

1. Entra como admin → pestaña **Admin** → sección **Nueva partida**.
2. (Opcional) escribe un título para el recuerdo, por ejemplo "FamilyMarket · Viaje a Margarita".
3. Escribe `REINICIAR` y pulsa **Archivar y reiniciar partida**.

Esto guarda una copia completa de la partida actual en **Recuerdos** (jugadores, mercados, acciones, operaciones
e historial de precios) y luego deja a todos en $1,000 sin mercados. **Las cuentas y nombres de usuario se
conservan.** La partida de febrero 2026 ya está archivada como *"FamilyMarket · Febrero 2026"*.

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
- **Estado compartido** (`GameContext`): una sola petición periódica por usuario, sin importar cuántas pantallas visite.
- **Seguridad por capas:** ningún rol de la API puede escribir tablas; todo pasa por RPC que validan identidad,
  rol admin, mercado abierto, saldo, límites y slippage.

### Estructura del repo

```
src/                  App (pages, components, context, hooks, lib)
supabase/migrations/  Esquema completo versionado (001…005). Aplicar en orden en el SQL Editor.
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

## Desarrollo

```bash
npm install
cp .env.example .env.local     # VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev                    # http://localhost:5173
npm run build                  # build de producción (PWA)
```

### Pruebas

Requieren usuarios de prueba temporales (`lt_00@loadtest.invalid` admin, `lt_01…lt_13`) y un archivo de credenciales
**fuera del repo** (`{"password":"…","prefix":"lt_","domain":"loadtest.invalid","count":14}`):

```bash
LOADTEST_ENV=/ruta/testenv.json npm run test:load     # 100 verificaciones: seguridad, lógica, concurrencia
LOADTEST_ENV=/ruta/testenv.json npm run test:ui       # 3 recorridos E2E de la interfaz real
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
- **Registro de actividad del admin:** pestaña Admin (crear/resolver/anular mercados, ajustes de saldo, reinicios).
- **PWA instalada antes de esta versión:** al abrir la app se actualiza sola; si ves la versión vieja, cierra y
  vuelve a abrir (o recarga) una vez.
