-- =====================================================================
-- 011 · El staff necesita poder "ver" los objetos del bucket para poder borrarlos
--       (la API de Storage consulta con SELECT antes de borrar). La lectura publica
--       de las fotos (URL publica del CDN) no depende de esta politica.
-- =====================================================================
drop policy if exists market_images_select on storage.objects;
create policy market_images_select on storage.objects for select to authenticated
  using (bucket_id = 'market-images' and public.is_staff());
