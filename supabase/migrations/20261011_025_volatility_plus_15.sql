-- 025 · +15 % de volatilidad: menos «tokens» (liquidez) en cada mercado
--
-- En el mercado CPMM de la app, cuánto se mueve el precio con cada dólar es inversamente proporcional a la liquidez
-- (profundidad = raíz de yes_pool × no_pool). Dividir la liquidez entre 1.15 hace que el MISMO dinero mueva el precio
-- ~15 % más (comprobado: 1.148 en compras de $5 a $200).
--
--  · Mercados nuevos: la liquidez inicial pasa de 2000 a 1739.13 (= 2000 / 1.15).
--  · Mercados ya creados y abiertos: sus dos piscinas se dividen entre 1.15. Como se escalan las DOS por igual, el
--    PRECIO no cambia, ni el valor de las posiciones de nadie, ni el patrimonio de ningún jugador; solo cambia cuánto
--    se mueve el precio con las próximas operaciones. Los mercados ya resueltos no se tocan.
--  · Es seguro repetirla: solo actúa si la liquidez todavía vale 2000 (si no, no hace nada, para no escalar dos veces).

do $$
declare
  v_rows int;
begin
  update public.game_settings set initial_liquidity = 1739.13 where id and initial_liquidity = 2000;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    update public.markets
       set yes_pool = round(yes_pool / 1.15, 10),
           no_pool  = round(no_pool  / 1.15, 10)
     where not closed;
  end if;
end $$;

alter table public.game_settings alter column initial_liquidity set default 1739.13;
