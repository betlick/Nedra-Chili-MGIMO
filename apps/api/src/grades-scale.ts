/**
 * Шкала оценок и допуск. Считает код, а не модель.
 * Менее 40 — «2», 40–59 — «3», 60–79 — «4», от 80 — «5»; зачёт от 40; допуск к сессии — не менее 50 по каждой дисциплине.
 * Те же пороги во фронтенде: apps/web/src/lib/format.ts (markFor, gradeLabel).
 */
export const ADMISSION = 50;
export const CREDIT = 40;
export const MARKS = [[80, 5], [60, 4], [40, 3]] as const;
export type Form = 'Экзамен' | 'Зачёт';
export const markFor = (score: number) => MARKS.find(([min]) => score >= min)?.[1] ?? 2;

export interface GradeFact {
  subject: string; form: Form; score: number;
  result: string; admitted: boolean; toAdmission: number;
  next: string | null; toNext: number;
}
export function gradeFacts(rows: { subject: string; form: Form; score: number }[]) {
  const items: GradeFact[] = rows.map(({ subject, form, score }) => {
    const admitted = score >= ADMISSION;
    if (form === 'Зачёт') {
      const passed = score >= CREDIT;
      return { subject, form, score, result: passed ? 'зачтено' : 'не зачтено', admitted, toAdmission: Math.max(0, ADMISSION - score), next: passed ? null : 'зачёт', toNext: passed ? 0 : CREDIT - score };
    }
    const mark = markFor(score);
    const target = [...MARKS].reverse().find(([min]) => min > score);
    return { subject, form, score, result: String(mark), admitted, toAdmission: Math.max(0, ADMISSION - score), next: target ? String(target[1]) : null, toNext: target ? target[0] - score : 0 };
  });
  const average = items.length ? Math.round(items.reduce((s, i) => s + i.score, 0) / items.length) : 0;
  return { average, admittedCount: items.filter(i => i.admitted).length, items };
}
