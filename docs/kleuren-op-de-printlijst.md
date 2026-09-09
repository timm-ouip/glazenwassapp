# Eigen kleuren op de printlijst

Gebouwd op 9 september 2026.

Tot nu toe zaten er twee kleuren vast in de code: geel betekende "extra
opletten", groen "nieuwe klant". Wat een kleur betekent verschilt per bedrijf,
en twee is soms te weinig. Vanaf nu maak je ze zelf bij **Instellingen →
Kleuren**, met je eigen tekst erbij, en wat je daar maakt staat meteen onder de
rechtermuisknop op een adres.

## Drie keuzes die uitleg verdienen

**De kleur kies je uit vier, niet vrij.** Amber, groen, paars en blauw. Die
vier zijn in het ontwerp uitgezocht op leesbaarheid: ze hebben allemaal een
lichte en een donkere variant, en ze blijven leesbaar op papier. Een vrij
gekozen kleurcode zou in de donkere modus of op een zwart-witprint zomaar
kunnen wegvallen, en dat merk je pas als de lijst al in de auto ligt. Blauw is
nieuw en alleen hiervoor toegevoegd.

**Rood zit er niet bij.** Dat betekent al "deze maand overgeslagen", en dat is
niets wat je zelf aanzet — het volgt uit de maanden die je overslaat. Twee
betekenissen op één kleur is er één te veel. Op de printlijst kleurt rood
trouwens nooit: een overgeslagen adres staat daar helemaal niet op.

**Groen voor een nieuwe klant blijft apart.** Dat is geen markering die je
kunt weghalen; het volgt uit de startmaand, net als eerst. Verwijder je de
kleur "Nieuwe klant" uit de lijst, dan blijft een nieuw adres dus gewoon groen.

## Hoe het in elkaar zit

- Tabel `markeringen` (bedrijf, sleutel, naam, tint, volgorde). De policy volgt
  het patroon van `wasdag_regels`, met `(select public.current_company_id())`.
- `customers.markering` blijft de tekstkolom die er al was; daar staat de
  sleutel in. De twee die er waren houden hun sleutel `geel` en `groen`, en zijn
  bij de migratie voor elk bestaand bedrijf aangemaakt met hun oude tekst. Voor
  wie niets verandert, verandert er dus niets.
- De `check`-beperking op die kolom is weggehaald: welke sleutels bestaan staat
  nu in de tabel.
- Nieuwe kleuren krijgen een willekeurige sleutel (`crypto.randomUUID()`).
- `regelKleur(c, maand, markeringen)` geeft nu een tint terug in plaats van een
  markering. Staat er een sleutel op een adres die je inmiddels weggegooid hebt,
  dan kleurt de regel niet meer — maar de waarde blijft staan, dus met dezelfde
  sleutel terug is de kleur er ook weer. Dat kan alleen via de database; door de
  app opnieuw aanmaken geeft een nieuwe sleutel.

## Wat er getest is

Kleur "Hoge ramen" (paars) toegevoegd bij Instellingen, waarna hij in het
rechtermuisknopmenu op een adres stond, tussen "Extra opletten" en "Nieuwe
klant". Aangeklikt op Scheygrond 2: de regel werd paars. De twee bestaande
kleuren staan er nog met hun oude tekst.
