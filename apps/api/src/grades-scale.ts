/**
 * Шкала оценок. Считает код, а не модель.
 * Менее 40 — «2», 40–59 — «3», 60–79 — «4», от 80 — «5»; зачёт и проходной итоговый результат — от 40.
 * Правило допуска к экзамену пока не определено (spec.md), поэтому «допуск» здесь не считается.
 * Те же пороги во фронтенде: apps/web/src/lib/format.ts (markFor, gradeLabel).
 */
export const PASS = 40;
export const CREDIT = PASS;
export const MARKS = [[80, 5], [60, 4], [40, 3]] as const;
export type Form = 'Экзамен' | 'Зачёт';
export const markFor = (score: number) => MARKS.find(([min]) => score >= min)?.[1] ?? 2;

export interface GradeFact {
  subject: string; form: Form; score: number;
  result: string; passed: boolean; toPass: number;
  next: string | null; toNext: number;
}
export function gradeFacts(rows: { subject: string; form: Form; score: number }[]) {
  const items: GradeFact[] = rows.map(({ subject, form, score }) => {
    const passed = score >= PASS, toPass = Math.max(0, PASS - score);
    if (form === 'Зачёт')
      return { subject, form, score, result: passed ? 'зачтено' : 'не зачтено', passed, toPass, next: passed ? null : 'зачёт', toNext: toPass };
    const target = [...MARKS].reverse().find(([min]) => min > score);
    return { subject, form, score, result: String(markFor(score)), passed, toPass, next: target ? String(target[1]) : null, toNext: target ? target[0] - score : 0 };
  });
  const average = items.length ? Math.round(items.reduce((s, i) => s + i.score, 0) / items.length) : 0;
  return { average, passedCount: items.filter(i => i.passed).length, items };
}
