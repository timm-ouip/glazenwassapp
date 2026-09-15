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

/**
 * Een lijst in stukken van PAGINA ophalen tot hij op is. `pagina` maakt de
 * opvraging voor één stuk (met `.range(van, tot)`); die moet een volgorde
 * hebben die eindigt op iets unieks, zoals id. Anders kunnen rijen op de naad
 * tussen twee stukken wegvallen of dubbel komen.
 *
 * Pas stoppen bij een leeg stuk, niet bij een kort: staat de grens van de
 * server ooit lager dan PAGINA, dan zou een kort stuk er anders uitzien als
 * het laatste. Dat kost hooguit één opvraging extra.
 */
export async function haalAllePaginas<T>(
  pagina: (van: number, tot: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const alles: T[] = [];
  for (;;) {
    const van = alles.length;
    const { data, error } = await pagina(van, van + PAGINA - 1);
    if (error) throw error;
    const rijen = data ?? [];
    if (rijen.length === 0) return alles;
    alles.push(...rijen);
  }
}
