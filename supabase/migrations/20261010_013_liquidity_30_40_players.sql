-- Liquidez inicial de los mercados NUEVOS: 1200 -> 2000.
-- Con 30-40 jugadores, 1200 movía demasiado el precio por operación (una apuesta de $100 subía ~4 puntos y el
-- p95 de los saltos era de 8.5 puntos). Con 2000: $100 mueve ~2.4 puntos, p95 = 5.1 y un consenso total
-- (40 jugadores x $100) llega a ~90 % sin tocar el tope de 99 %. Detalle y tabla comparativa: scripts/calibrate.mjs.
-- Los mercados que ya existen conservan sus piscinas (la liquidez se copia al crearlos).
update public.game_settings set initial_liquidity = 2000;
