import { createHash } from 'node:crypto';
/** Кэш готовых ответов в памяти (LRU, срок 24 часа). Ключ — пользователь и хэш входных данных. */
export function createCache<T>(max = 1000, ttl = 24 * 3_600_000) {
  const map = new Map<string, { value: T; until: number }>();
  return {
    get(key: string): T | undefined {
      const hit = map.get(key);
      if (!hit) return undefined;
      map.delete(key);
      if (hit.until < Date.now()) return undefined;
      map.set(key, hit);
      return hit.value;
    },
    set(key: string, value: T) {
      map.delete(key);
      map.set(key, { value, until: Date.now() + ttl });
      if (map.size > max) map.delete(map.keys().next().value!);
    },
  };
}
export const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
