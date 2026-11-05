export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function parts(key: string): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number);
  return [y ?? 0, m ?? 1, d ?? 1];
}

const MS_DAY = 86_400_000;

function utcDays(key: string): number {
  const [y, m, d] = parts(key);
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
}

const EPOCH = Math.round(Date.UTC(2026, 10, 1) / MS_DAY);

/** 2026-11-1 is day 1. */
export function dayNumber(key: string): number {
  return utcDays(key) - EPOCH + 1;
}

export function addDays(key: string, n: number): string {
  const t = new Date((utcDays(key) + n) * MS_DAY);
  return `${t.getUTCFullYear()}-${t.getUTCMonth() + 1}-${t.getUTCDate()}`;
}

export function compareKeys(a: string, b: string): number {
  return utcDays(a) - utcDays(b);
}
