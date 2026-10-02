/**
 * Lange lijsten in stukken ophalen.
 *
 * Supabase geeft per opvraging hooguit 1000 rijen terug. Vraag je meer, dan
 * krijg je zonder foutmelding gewoon de eerste 1000 en ontbreekt de rest. Na
 * een import met 1800 adressen vielen zo de hoge huisnummers stil van de
 * wijklijst.
 *
 * Eigen bestand, zodat klanten.ts, wasdag.ts en stoppen.ts het allemaal kunnen
 * gebruiken zonder elkaar in een kring te importeren.
 */

/** Zoveel rijen vragen we per stuk. */
export const PAGINA = 1000;

/** Zoveel stukken vragen we tegelijk, als het een lange lijst is. */
const TEGELIJK = 3;

/**
 * Een lijst in stukken van PAGINA ophalen tot hij op is. `pagina` maakt de
 * opvraging voor één stuk (met `.range(van, tot)`); die moet een volgorde
 * hebben die eindigt op iets unieks, zoals id. Anders kunnen rijen op de naad
 * tussen twee stukken wegvallen of dubbel komen.
 *
 * Is het eerste stuk vol, dan vragen we de volgende stukken tegelijk: na
 * elkaar kostte een lijst van 2700 adressen op 4G vier keer wachten. Ze komen
 * in dezelfde volgorde achter elkaar. Een vol eerste stuk bewijst ook dat de
 * server er minstens PAGINA per keer geeft; een kort stuk is dan echt het
 * laatste.
 *
 * Is het eerste stuk kort, dan stuk voor stuk, en pas stoppen bij een leeg
 * stuk: staat de grens van de server ooit lager dan PAGINA, dan zou een kort
 * stuk er anders uitzien als het laatste. Dat kost hooguit één opvraging
 * extra.
 */
export async function haalAllePaginas<T>(
  pagina: (van: number, tot: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const stuk = async (van: number): Promise<T[]> => {
    const { data, error } = await pagina(van, van + PAGINA - 1);
    if (error) throw error;
    return data ?? [];
  };

  const alles = [...(await stuk(0))];
  if (alles.length === 0) return alles;

  if (alles.length < PAGINA) {
    for (;;) {
      const rijen = await stuk(alles.length);
      if (rijen.length === 0) return alles;
      alles.push(...rijen);
    }
  }

  for (;;) {
    const van = alles.length;
    const stukken = await Promise.all(
      Array.from({ length: TEGELIJK }, (_, i) => stuk(van + i * PAGINA)),
    );
    for (const rijen of stukken) {
      alles.push(...rijen);
      if (rijen.length < PAGINA) return alles;
    }
  }
}
