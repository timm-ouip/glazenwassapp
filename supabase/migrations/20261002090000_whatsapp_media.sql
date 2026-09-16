-- WhatsApp, fase 2: foto's, spraakberichten en andere bestanden bewaren.
--
-- Meta bewaart media maar 7 dagen; de webhook haalt ze meteen op en zet ze
-- in deze afgesloten opslag, onder <bedrijf>/<bericht>/<bestand>. Alleen de
-- server schrijft; lezen mag wie berichten mag lezen, en alleen van het
-- eigen bedrijf. De app vraagt er een tijdelijke link voor.

insert into storage.buckets (id, name, public, file_size_limit)
values ('whatsapp-media', 'whatsapp-media', false, 104857600)
on conflict (id) do nothing;

drop policy if exists "WhatsApp-media lezen met recht" on storage.objects;
create policy "WhatsApp-media lezen met recht" on storage.objects for select to authenticated
  using (
    bucket_id = 'whatsapp-media'
    and (storage.foldername(name))[1] = (select public.current_company_id())::text
    and (select public.heeft_recht('mail_lezen'))
  );
