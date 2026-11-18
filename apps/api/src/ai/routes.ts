import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { actor, assignmentFilter, assignmentsQuery, DomainError, fail, type Authorize, type Db } from '../domain.js';
import { gradeEntries } from '../schema.js';
import { gradeFacts, ADMISSION, CREDIT, MARKS } from '../grades-scale.js';
import { AiError, type AiCall, type AiProvider, type AiReason } from './provider.js';
import { createCache, fingerprint } from './cache.js';
import type { Limiter } from './limit.js';
import { extractJson, parseInsight, type Insight } from './validate.js';
import { GRADES_SYSTEM, gradesUser } from './prompts/grades-insight.js';

export interface AiDeps { provider: AiProvider | null; limiter: Limiter; timeoutMs: number }
type Outcome<T> = { ok: true; value: T } | { ok: false; reason: AiReason };

/**
 * /api/ai/grades-insight — разбор успеваемости. Маршрут ничего не создаёт и не меняет:
 * числа считает код, модель только пишет текст по ним.
 */
export function aiRoutes(app: FastifyInstance, db: Db, auth: Authorize, deps: AiDeps) {
  const insights = createCache<Insight>();

  async function role(id: string, ...allowed: string[]) {
    const u = await actor(db, id);
    if (!allowed.includes(u.role)) fail(403, 'Нет доступа к разделу');
    return u;
  }
  /** Один вызов модели: лимит, тайм-аут, разбор JSON. Ошибки провайдера не раскрываются. */
  async function run<T>(userId: string, call: AiCall, parse: (value: unknown) => T | null): Promise<Outcome<T>> {
    if (!deps.provider) return { ok: false, reason: 'disabled' };
    const wait = deps.limiter.take(userId);
    if (wait !== null) throw new DomainError(429, 'RATE_LIMITED', `Лимит разборов ИИ исчерпан. Попробуйте через ${wait} мин`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
    let raw: string;
    try {
      raw = await deps.provider.complete(call, controller.signal);
    } catch (e) {
      const reason: AiReason = controller.signal.aborted ? 'timeout' : e instanceof AiError ? e.reason : 'unavailable';
      app.log.warn({ ai: call.task, provider: deps.provider.name, reason }, 'AI call failed');
      return { ok: false, reason };
    } finally { clearTimeout(timer); }
    const value = parse(extractJson(raw));
    if (value === null) {
      app.log.warn({ ai: call.task, provider: deps.provider.name, reason: 'invalid' }, 'AI answer rejected by schema');
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, value };
  }
  const reply = <T extends object>(outcome: Outcome<T>) => outcome.ok ? { data: { ok: true as const, ...outcome.value } } : { data: { ok: false as const, reason: outcome.reason } };

  // Разбор успеваемости. Числа считает код, модель пишет текст. Кэш по студенту и хэшу баллов.
  app.get('/api/ai/grades-insight', async (req, res) => {
    const id = await auth(req, res); if (!id) return;
    const u = await role(id, 'student');
    const assignments = await assignmentsQuery(db).where(assignmentFilter(u));
    const entries = await db.select().from(gradeEntries).where(eq(gradeEntries.studentId, id));
    const semester = Math.max(0, ...assignments.map(a => a.semester));
    const rows = assignments.filter(a => a.semester === semester).flatMap(a => {
      const score = entries.find(e => e.assignmentId === a.id)?.score;
      return typeof score === 'number' ? [{ subject: a.subject, form: a.form as 'Экзамен' | 'Зачёт', score }] : [];
    }).sort((a, b) => a.subject.localeCompare(b.subject, 'ru'));
    if (!rows.length) return { data: { ok: true, summary: null, items: [] } };
    const facts = gradeFacts(rows);
    const key = `${id}:${fingerprint(rows)}`;
    const hit = insights.get(key);
    if (hit) return reply<Insight>({ ok: true, value: hit });
    const input = {
      средний_балл: facts.average,
      допуск_есть: `${facts.admittedCount} из ${facts.items.length}`,
      дисциплины: facts.items.map(i => ({
        дисциплина: i.subject, форма: i.form, балл: i.score, результат: i.result,
        допуск: i.admitted, не_хватает_до_допуска: i.toAdmission,
        следующая_оценка: i.next, не_хватает_до_следующей: i.toNext,
      })),
    };
    const allowed = new Set<number>([facts.average, facts.admittedCount, facts.items.length, ADMISSION, CREDIT, ...MARKS.flat(), 1, 2, 3, 4, 5,
      ...facts.items.flatMap(i => [i.score, i.toAdmission, i.toNext])]);
    const outcome = await run(id, { task: 'grades', system: GRADES_SYSTEM, user: gradesUser(input), json: true },
      v => parseInsight(v, rows.map(r => r.subject), allowed));
    if (outcome.ok) insights.set(key, outcome.value);
    return reply(outcome);
  });
}
