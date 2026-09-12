-- Om de 4 maanden erbij als frequentie.
--
-- interval_maanden mocht alleen 1, 2, 3, 6 of 12 zijn: de ritmes die precies
-- in een jaar passen en waarvan we toen wisten dat ze voorkwamen. Om de 4 past
-- daar net zo goed in — drie beurten per jaar, 1·5·9 tot en met 4·8·12 — en is
-- gewoon een keuze die in de praktijk voorkomt.
--
-- De regel heet bij Postgres zelf iets als customers_interval_maanden_check,
-- maar dat is een naam die hij verzint. Daarom zoeken we hem op aan wat er in
-- staat en niet aan zijn naam: dan werkt dit ook als hij anders heet.
do $$
declare
  regel text;
begin
  for regel in
    select conname
    from pg_constraint
    where conrelid = 'public.customers'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%interval_maanden%'
  loop
    execute format('alter table public.customers drop constraint %I', regel);
  end loop;
end $$;

alter table public.customers
  add constraint customers_interval_maanden_check
  check (interval_maanden in (1, 2, 3, 4, 6, 12));
