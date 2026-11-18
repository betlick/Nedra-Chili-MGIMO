/** Лимит обращений к модели на пользователя. В памяти процесса: на Amvera один контейнер, после перезапуска счётчик обнуляется. */
export function createLimiter(perHour: number, now = () => Date.now()) {
  const hits = new Map<string, number[]>();
  return {
    /** Возвращает null, если вызов разрешён, иначе через сколько минут попробовать снова. */
    take(userId: string): number | null {
      const t = now(), from = t - 3_600_000;
      const list = (hits.get(userId) ?? []).filter(x => x > from);
      if (list.length >= perHour) { hits.set(userId, list); return Math.max(1, Math.ceil((list[0]! - from) / 60_000)); }
      list.push(t);
      hits.set(userId, list);
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(x => x > from)) hits.delete(k);
      return null;
    },
  };
}
export type Limiter = ReturnType<typeof createLimiter>;
