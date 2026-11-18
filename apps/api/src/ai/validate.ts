/** Достаёт JSON-объект из ответа модели: без обёрток ```json и вступительных фраз. */
export function extractJson(raw: string): unknown {
  const text = raw.replace(/```(?:json)?/gi, '');
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Одна строка без управляющих символов и разметки. */
export const clean = (v: unknown, max: number) => typeof v === 'string'
  ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/[<>*_#`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';

export interface Insight { summary: string; items: { subject: string; note: string }[] }
/**
 * Разбор успеваемости: дисциплины — только из переданных, 1–4 пункта.
 * Каждое число в тексте должно встречаться в посчитанных кодом данных: модель не придумывает баллы.
 */
export function parseInsight(value: unknown, subjects: string[], allowed: Set<number>): Insight | null {
  if (!isObject(value) || !Array.isArray(value.items)) return null;
  const summary = clean(value.summary, 300);
  const items = value.items.filter(isObject)
    .map(i => ({ subject: clean(i.subject, 200), note: clean(i.note, 300) }))
    .filter(i => i.note && subjects.includes(i.subject))
    .filter((i, n, all) => all.findIndex(x => x.subject === i.subject) === n)
    .slice(0, 4);
  if (!summary || !items.length) return null;
  const numbers = [summary, ...items.map(i => i.note)].join(' ').match(/\d+/g) ?? [];
  if (numbers.some(n => !allowed.has(Number(n)))) return null;
  return { summary, items };
}
