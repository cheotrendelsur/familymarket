-- =====================================================================
-- 009 · STORAGE: fotos de mercados
--   Bucket publico de solo lectura (las URL publicas las sirve el CDN de
--   Supabase con cache) y escritura SOLO para staff (dueno/moderadores).
--   El cliente ya sube la imagen procesada: WebP (o JPEG en Safari) de
--   <= ~100 KB y una miniatura de <= ~15 KB, asi que 1 MB de tope sobra.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('market-images', 'market-images', true, 1048576, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = true,
      file_size_limit = 1048576,
      allowed_mime_types = array['image/webp', 'image/jpeg'];

drop policy if exists market_images_insert on storage.objects;
create policy market_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'market-images' and public.is_staff());

drop policy if exists market_images_update on storage.objects;
create policy market_images_update on storage.objects for update to authenticated
  using (bucket_id = 'market-images' and public.is_staff())
  with check (bucket_id = 'market-images' and public.is_staff());

drop policy if exists market_images_delete on storage.objects;
create policy market_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'market-images' and public.is_staff());
