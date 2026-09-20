/**
 * Net genoeg van `bun:test` om de tests mee te laten lopen in `tsc --noEmit`.
 *
 * Bewust geen `@types/bun` als afhankelijkheid: dat pakket trekt de hele
 * Bun-omgeving de typecheck in (en een nieuw pakket betekent een herstart van
 * de dev-server). De tests draaien met `bun test`.
 */
declare module "bun:test" {
  export function describe(naam: string, fn: () => void): void;
  export function test(naam: string, fn: () => void | Promise<void>): void;
  export function expect(waarde: unknown): {
    toBe(verwacht: unknown): void;
    toEqual(verwacht: unknown): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toContain(deel: unknown): void;
    toHaveLength(lengte: number): void;
    toThrow(bericht?: string | RegExp): void;
  };
}
