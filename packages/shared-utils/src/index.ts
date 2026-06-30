export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIsoDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function createId(prefix: string, seed?: string): string {
  const body = seed
    ? stableHash(seed).toString(36)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${body}`;
}

export function stableHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededScore(seed: string, min = 0, max = 1): number {
  const normalized = stableHash(seed) / 0xffffffff;
  return round(min + normalized * (max - min), 4);
}

export function weightedAverage(
  entries: Array<{ value: number; weight: number }>
): number {
  const denominator = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (denominator === 0) return 0;
  return entries.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / denominator;
}

export function weightedScore<T>(
  item: T,
  weights: Record<string, number>,
  project: Record<string, (item: T) => number>
): number {
  const entries = Object.entries(weights).map(([key, weight]) => ({
    value: project[key]?.(item) ?? 0,
    weight
  }));
  return round(weightedAverage(entries), 4);
}

export function sortByScore<T>(
  items: T[],
  score: (item: T) => number,
  direction: "asc" | "desc" = "desc"
): T[] {
  const multiplier = direction === "desc" ? -1 : 1;
  return [...items].sort((left, right) => multiplier * (score(left) - score(right)));
}

export function takeWeighted<T>(
  items: T[],
  count: number,
  score: (item: T) => number
): T[] {
  return sortByScore(items, score).slice(0, Math.max(0, count));
}

export function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function partition<T>(items: T[], predicate: (item: T) => boolean): [T[], T[]] {
  const yes: T[] = [];
  const no: T[] = [];
  for (const item of items) {
    if (predicate(item)) yes.push(item);
    else no.push(item);
  }
  return [yes, no];
}

export function minutesFromNow(minutes: number, base = new Date()): string {
  return new Date(base.getTime() + minutes * 60_000).toISOString();
}

export function humanMinutes(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}
