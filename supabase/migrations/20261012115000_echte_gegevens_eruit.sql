-- Eenmalig: de echte gegevens eruit, er testgegevens voor terug.
--
-- Op 24-09-2026 gevraagd door Timmie, om beveiligingsredenen: zolang de
-- beveiliging nog niet rond is, horen de echte klantgegevens hier niet te
-- staan. Hij zet ze later zelf weer terug.
--
-- Dit is met opzet een migratie en geen los scriptje: zo staat er in de
-- geschiedenis van de app precies wat er is weggehaald en wanneer. Ze draait
-- maar één keer; een lege database heeft er geen last van.
--
-- WAT ER BLIJFT: de wijken, straten, huisnummers, de planning en de
-- werknotities op een adres ("VKZK", "HD+vx"). Dat zijn geen persoonlijke
-- gegevens, en zonder die dingen valt er niets meer te testen.
--
-- WAT ER NIET MEE OPGERUIMD KAN WORDEN: Supabase bewaart zelf automatische
-- back-ups van de database. Die zitten niet in dit schema; die moeten via het
-- dashboard van Supabase weg.

-- ---------------------------------------------------------------------
-- 1. Het herstelpunt van een uur geleden weer weg
-- ---------------------------------------------------------------------
-- Dat stond in dezelfde database, en dat is precies wat hier niet hoort.
drop table if exists public.herstel_klanten;
drop table if exists public.herstel_customers;
drop table if exists public.herstel_adres_prijzen;
drop table if exists public.herstel_klus_prijzen;
drop table if exists public.herstel_wasdag_prijzen;

-- ---------------------------------------------------------------------
-- 2. Het postvak, de klachten en alles wat van buiten kwam
-- ---------------------------------------------------------------------
-- In volgorde van afhankelijkheid, zodat geen enkele verwijzing blijft hangen.
-- Via een lijst, want een paar van deze tabellen zijn onderweg hernoemd of
-- verdwenen en dan hoort deze opruiming niet stuk te lopen op een naam.
do $$
declare
  tabellen text[] := array[
    'klacht_berichten', 'klachten', 'bericht_categorieen',
    'paaltje_voorstellen', 'paaltje_afspraken', 'paaltje_berichten',
    'mail_antwoorden', 'berichten', 'mail_mappen',
    'geplande_mails', 'mail_verzendpogingen', 'mail_wijzigingen',
    -- De mailbox zelf, inclusief het versleutelde wachtwoord. Opnieuw
    -- verbinden gaat straks zoals de eerste keer: bij Instellingen → Mail de
    -- gegevens invullen. De mail zelf staat op de mailserver en is niet weg.
    'mailbox_geheimen', 'mailboxen',
    'mail_ontvangers', 'mailingen',
    'aankondiging_adressen', 'aanmeldingen',
    'dagrapporten', 'quick_notes'
  ];
  t text;
begin
  foreach t in array tabellen loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from public.%I', t);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- 3. Verzonnen namen, mailadressen en telefoonnummers
-- ---------------------------------------------------------------------
-- De mailadressen eindigen op ".test". Dat is een domein dat nooit bestaat en
-- waar nooit iets naartoe kan, ook niet als er per ongeluk een mailing uitgaat.
do $$
declare
  voornamen text[] := array['Anne','Bram','Carla','Daan','Eva','Femke','Gijs','Hanna','Ivo','Julia',
                            'Koen','Lotte','Mees','Nora','Otto','Pien','Quinten','Roos','Sam','Tess',
                            'Ursula','Vince','Wendy','Xander','Yara','Zeno'];
  achternamen text[] := array['de Vries','Jansen','Bakker','Visser','Smit','Meijer','Mulder','Bos',
                              'Vos','Peters','Hendriks','van Dijk','Kuipers','Dekker','Brouwer',
                              'de Boer','Willems','van Leeuwen','Smits','de Graaf'];
  plaatsen text[] := array['Testdorp','Proefstad','Voorbeeldburg','Oefenhoek'];
begin
  update public.klanten k
     set naam = voornamen[1 + (abs(hashtext(k.id::text)) % array_length(voornamen, 1))]
                || ' ' ||
                achternamen[1 + (abs(hashtext(k.id::text || 'a')) % array_length(achternamen, 1))],
         bedrijfsnaam = case when coalesce(btrim(k.bedrijfsnaam), '') = '' then k.bedrijfsnaam
                             else 'Testbedrijf ' || upper(substr(k.id::text, 1, 4)) end,
         email = 'klant-' || substr(k.id::text, 1, 8) || '@voorbeeld.test',
         email2 = case when coalesce(btrim(k.email2), '') = '' then k.email2
                       else 'klant-' || substr(k.id::text, 1, 8) || '-2@voorbeeld.test' end,
         factuur_email = case when coalesce(btrim(k.factuur_email), '') = '' then k.factuur_email
                              else 'facturen-' || substr(k.id::text, 1, 8) || '@voorbeeld.test' end,
         telefoon = '06' || lpad((abs(hashtext(k.id::text || 't')) % 100000000)::text, 8, '0'),
         telefoon2 = case when coalesce(btrim(k.telefoon2), '') = '' then k.telefoon2
                          else '06' || lpad((abs(hashtext(k.id::text || 't2')) % 100000000)::text, 8, '0') end,
         notitie = '',
         kvk = case when coalesce(btrim(k.kvk), '') = '' then k.kvk else '99999999' end,
         btw_nummer = case when coalesce(btrim(k.btw_nummer), '') = '' then k.btw_nummer
                           else 'NL999999999B01' end,
         website = '',
         straat = case when coalesce(btrim(k.straat), '') = '' then k.straat else 'Teststraat' end,
         huisnummer = case when coalesce(btrim(k.huisnummer), '') = '' then k.huisnummer
                           else (1 + (abs(hashtext(k.id::text || 'h')) % 200))::text end,
         postcode = case when coalesce(btrim(k.postcode), '') = '' then k.postcode
                         else lpad((1000 + (abs(hashtext(k.id::text || 'p')) % 8999))::text, 4, '0') || ' AA' end,
         plaats = case when coalesce(btrim(k.plaats), '') = '' then k.plaats
                       else plaatsen[1 + (abs(hashtext(k.id::text || 'w')) % array_length(plaatsen, 1))] end;
end
$$;

-- De aparte mailadressentabel wordt uit `klanten` gevuld; die mag nu leeg,
-- dan staat er niets ouds meer in.
delete from public.klant_emails;

-- ---------------------------------------------------------------------
-- 4. Willekeurige prijzen
-- ---------------------------------------------------------------------
-- Tussen € 12,50 en € 60,00, op halve euro's. Ook de prijzen die al aan een
-- gereden dag hangen, anders staat de echte omzet nog in de geschiedenis.
update public.adres_prijzen
   set prijs = round((12.5 + random() * 47.5) * 2) / 2;

update public.klus_prijzen
   set prijs = round((12.5 + random() * 47.5) * 2) / 2;

update public.wasdag_prijzen
   set prijs = round((12.5 + random() * 47.5) * 2) / 2;

-- En de bedragen die al op een factuurregel staan; hier is er maar één (de
-- proefverzending van vanmiddag), maar de regel hoort te kloppen.
update public.factuurregels fr
   set bedrag = round((12.5 + random() * 47.5) * 2) / 2
 where fr.deleted_at is null;
update public.factuurregels fr
   set bedrag_excl = public.factuur_excl(fr.bedrag, fr.btw_inclusief, fr.btw_procent)
 where fr.deleted_at is null;

-- ---------------------------------------------------------------------
-- 5. Willekeurige frequenties
-- ---------------------------------------------------------------------
-- Elke maand, even maanden, oneven maanden, of om de drie. `ritme` is de
-- ankermaand binnen het interval en moet daar dus bij passen.
update public.customers c
   set interval_maanden = x.stap,
       ritme = x.anker,
       frequency = case
         when x.stap = 1 then 'elke'
         when x.anker = 2 then 'even'
         else 'oneven'
       end
  from (
    select b.id, b.stap, 1 + (abs(hashtext(b.id::text || 'r')) % b.stap) as anker
      from (
        select id, (array[1, 2, 2, 3])[1 + (abs(hashtext(id::text || 'i')) % 4)] as stap
          from public.customers
      ) b
  ) x
 where x.id = c.id;

-- ---------------------------------------------------------------------
-- 6. Verzonnen wijk- en straatnamen
-- ---------------------------------------------------------------------
-- Ook de plattegrond moet nep zijn: aan "Markgraaf A in Madestein" is te zien
-- waar je werkt. De namen worden op volgorde uitgedeeld, zodat ze binnen een
-- bedrijf niet twee keer voorkomen.
do $$
declare
  wijknamen text[] := array['Noorderwijk','Zuiderwijk','Westerwijk','Oosterwijk','Middenwijk',
                            'Parkwijk','Havenwijk','Bosrand','Duinzicht','Molenbuurt'];
  plaatsen text[] := array['Testdorp','Proefstad','Voorbeeldburg','Oefenhoek'];
  eerste text[] := array['Beuken','Lijster','Eiken','Merel','Wilgen','Vink','Iepen','Spreeuw',
                         'Linden','Zwaluw','Esdoorn','Reiger'];
  tweede text[] := array['laan','straat','weg','hof','singel','pad'];
begin
  -- Wijken
  update public.districts d
     set name = case
           when n.nr <= array_length(wijknamen, 1) then wijknamen[n.nr]
           else 'Wijk ' || n.nr
         end,
         plaats = plaatsen[1 + ((n.nr - 1) % array_length(plaatsen, 1))]
    from (select id, row_number() over (partition by company_id order by sort_order, id) as nr
            from public.districts) n
   where n.id = d.id;

  -- Straten: twee lijstjes gecombineerd, dus 72 verschillende namen.
  update public.streets s
     set name = eerste[1 + ((n.nr - 1) % array_length(eerste, 1))]
                || tweede[1 + (((n.nr - 1) / array_length(eerste, 1)) % array_length(tweede, 1))],
         volledige_naam = eerste[1 + ((n.nr - 1) % array_length(eerste, 1))]
                || tweede[1 + (((n.nr - 1) / array_length(eerste, 1)) % array_length(tweede, 1))]
    from (select id, row_number() over (partition by company_id order by sort_order, id) as nr
            from public.streets) n
   where n.id = s.id;
end
$$;

-- De groepjes waarin straten gebundeld staan heten vaak naar de buurt.
update public.straat_groepen set naam = 'Groep ' || upper(substr(id::text, 1, 4));

-- En de postcode bij een adres wijst net zo goed aan waar het ligt.
update public.customers
   set postcode = case when coalesce(btrim(postcode), '') = '' then postcode
                       else lpad((1000 + (abs(hashtext(id::text || 'pc')) % 8999))::text, 4, '0')
                            || ' ' || chr(65 + (abs(hashtext(id::text || 'l1')) % 26))
                            || chr(65 + (abs(hashtext(id::text || 'l2')) % 26)) end;

-- Losse teksten die een echte straat of naam kunnen noemen.
update public.customers
   set hoek_straat = case when coalesce(btrim(hoek_straat), '') = '' then hoek_straat else 'Zijstraat' end,
       hoek_straat_volledig = case when coalesce(btrim(hoek_straat_volledig), '') = ''
                                   then hoek_straat_volledig else 'Zijstraat' end;
