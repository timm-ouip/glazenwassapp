-- Waar de verstuurde facturen blijven.
--
-- De gegevens van een verstuurde factuur staan vast, dus je zou de PDF altijd
-- opnieuw kunnen maken. Toch bewaren we hem: in fase 2 kan de vormgeving
-- veranderen, en dan zou een "opnieuw gemaakte" factuur er anders uitzien dan
-- die de klant kreeg. Bij een controle wil je het papier laten zien dat je
-- echt verstuurd hebt.
--
-- Opgezet naar het model van whatsapp-media: niet openbaar, en de eerste map
-- is altijd het bedrijf.
insert into storage.buckets (id, name, public, file_size_limit)
values ('facturen', 'facturen', false, 26214400)
on conflict (id) do nothing;

create policy "Facturen van eigen bedrijf lezen" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'facturen'
    and (storage.foldername(name))[1] = (select public.current_company_id())::text
    and (select public.heeft_recht('facturen'))
  );
