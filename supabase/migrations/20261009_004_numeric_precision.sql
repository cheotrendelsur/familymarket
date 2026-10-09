-- =====================================================================
-- 004 · PRECISION NUMERICA
-- =====================================================================
-- El esquema original usaba numeric(12,2) para las piscinas del CPMM y
-- numeric(10,2) para el saldo: cada operacion redondeaba las piscinas a
-- centavos (el producto k = yes*no se desviaba) y los pagos a 2 decimales.
-- Se amplian las columnas: piscinas a 10 decimales, dinero a 4 decimales.
-- (El archivo "Recuerdos" se alinea para no perder precision en futuras partidas.)
-- =====================================================================

alter table public.markets
  alter column yes_pool type numeric(28,10),
  alter column no_pool  type numeric(28,10);

alter table public.market_prices_history
  alter column yes_pool type numeric(28,10),
  alter column no_pool  type numeric(28,10);

alter table public.profiles
  alter column balance type numeric(16,4);

alter table public.transactions
  alter column total_cost type numeric(16,4);

alter table public.transaction_logs
  alter column total_cost type numeric(16,4);

alter table archive.markets
  alter column yes_pool type numeric(28,10),
  alter column no_pool  type numeric(28,10);

alter table archive.market_prices_history
  alter column yes_pool type numeric(28,10),
  alter column no_pool  type numeric(28,10);

alter table archive.transactions
  alter column total_cost type numeric(16,4);

alter table archive.transaction_logs
  alter column total_cost type numeric(16,4);
