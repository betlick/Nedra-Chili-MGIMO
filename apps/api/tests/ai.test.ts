import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { hash } from 'argon2';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { connectDatabase } from '../src/db.js';
import { AiError, mockProvider, type AiProvider } from '../src/ai/provider.js';
import { createLimiter } from '../src/ai/limit.js';
import { gradeEntries, groups, sessions, subjects, teachingAssignments, users } from '../src/schema.js';

test('grades insight: student only, own scores, code-computed numbers, cache, limit and provider failures', async () => {
  const c = connectDatabase();
  const origin = 'http://localhost:5173', csrf = { 'x-csrf-protection': '1', origin };
  let calls = 0;
  let mode: 'ok' | 'invalid' | 'unavailable' | 'timeout' = 'ok';
  const base = mockProvider();
  const scripted: AiProvider = {
    name: 'mock',
    async complete(call, signal) {
      calls++;
      if (mode === 'invalid') return 'Конечно! Вот разбор: {summary: всё хорошо';
      if (mode === 'unavailable') throw new AiError('unavailable');
      if (mode === 'timeout') await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new AiError('timeout'))));
      return base.complete(call, signal);
    },
  };
  const app = buildApp({ logger: false, secureCookies: false, origin, ai: { provider: scripted, limiter: createLimiter(50), timeoutMs: 300 } });
  const off = buildApp({ logger: false, secureCookies: false, origin, ai: { provider: null } });
  const tight = buildApp({ logger: false, secureCookies: false, origin, ai: { provider: base, limiter: createLimiter(1) } });
  const suffix = randomUUID(), groupIds = [randomUUID(), randomUUID()];
  // 0, 1 — студенты разных групп; 2 — преподаватель; 3 — сотрудник.
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const subjectIds = [randomUUID(), randomUUID(), randomUUID()];
  const name = (i: number) => `ИИ-дисциплина ${i} ${suffix.slice(0, 6)}`;
  const password = randomBytes(24).toString('hex'), passwordHash = await hash(password);
  try {
    await c.db.insert(groups).values(groupIds.map((id, i) => ({ id, name: `AI-${i}-${suffix}`, faculty: 'Тест', program: 'Тест', year: 1 })));
    await c.db.insert(users).values(ids.map((id, i) => ({ id, email: `ai-${suffix}-${i}@example.test`, fullName: `Вымышленный ${i}`, faculty: 'Тест',
      role: i === 3 ? 'staff' : i === 2 ? 'teacher' : 'student', groupId: i < 2 ? groupIds[i] : null, passwordHash })));
    await c.db.insert(subjects).values(subjectIds.map((id, i) => ({ id, name: name(i) })));
    const assignments = await c.db.insert(teachingAssignments).values([
      { teacherId: ids[2]!, subjectId: subjectIds[0]!, groupId: groupIds[0]!, semester: 1, form: 'Экзамен' },
      { teacherId: ids[2]!, subjectId: subjectIds[1]!, groupId: groupIds[0]!, semester: 1, form: 'Зачёт' },
      { teacherId: ids[2]!, subjectId: subjectIds[2]!, groupId: groupIds[1]!, semester: 1, form: 'Экзамен' },
    ]).returning();
    await c.db.insert(gradeEntries).values([
      { assignmentId: assignments[0]!.id, studentId: ids[0]!, score: 48 },
      { assignmentId: assignments[1]!.id, studentId: ids[0]!, score: 36 },
    ]);
    const cookies: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: csrf, payload: { email: `ai-${suffix}-${i}@example.test`, password } });
      assert.equal(res.statusCode, 200);
      cookies.push(String(res.headers['set-cookie']).split(';')[0]!);
    }
    const insight = (i = 0, a = app, query = '') => a.inject({ method: 'GET', url: `/api/ai/grades-insight${query}`, headers: { cookie: cookies[i]! } });

    // Роли: преподаватель и сотрудник — 403.
    assert.equal((await insight(2)).statusCode, 403);
    assert.equal((await insight(3)).statusCode, 403);

    // Нет выставленных баллов — модель не вызывается.
    assert.deepEqual((await insight(1)).json().data, { ok: true, summary: null, items: [] });
    assert.equal(calls, 0);

    // Только свои баллы, средний балл посчитан кодом: (48 + 36) / 2 = 42.
    const mine = (await insight(0)).json().data;
    assert.equal(mine.ok, true);
    assert.deepEqual(mine.items.map((i: { subject: string }) => i.subject).sort(), [name(0), name(1)]);
    assert.match(mine.summary, /Средний балл 42/);
    assert.equal(calls, 1);
    // Чужой studentId в запросе ничего не меняет.
    assert.deepEqual((await insight(0, app, `?studentId=${ids[1]}`)).json().data.items.length, 2);
    await insight(0);
    assert.equal(calls, 1, 'repeated page open must use the cache');

    await c.db.insert(gradeEntries).values({ assignmentId: assignments[2]!.id, studentId: ids[1]!, score: 91 });
    const theirs = (await insight(1)).json().data;
    assert.deepEqual(theirs.items.map((i: { subject: string }) => i.subject), [name(2)]);
    assert.equal(calls, 2);

    // Изменились баллы — новый вызов; сбои модели не попадают на экран.
    await c.db.update(gradeEntries).set({ score: 55 }).where(eq(gradeEntries.assignmentId, assignments[0]!.id));
    mode = 'invalid';
    assert.deepEqual((await insight(0)).json().data, { ok: false, reason: 'invalid' });
    mode = 'unavailable';
    assert.deepEqual((await insight(0)).json().data, { ok: false, reason: 'unavailable' });
    mode = 'timeout';
    assert.deepEqual((await insight(0)).json().data, { ok: false, reason: 'timeout' });
    mode = 'ok';
    assert.equal((await insight(0)).json().data.ok, true);
    assert.equal(calls, 6);
    assert.deepEqual((await insight(0, off)).json().data, { ok: false, reason: 'disabled' });

    // Лимит вызовов модели.
    assert.equal((await insight(0, tight)).statusCode, 200);
    await c.db.update(gradeEntries).set({ score: 57 }).where(eq(gradeEntries.assignmentId, assignments[0]!.id));
    const limited = await insight(0, tight);
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().error.code, 'RATE_LIMITED');

    await c.db.delete(sessions).where(eq(sessions.userId, ids[0]!));
    assert.equal((await insight(0)).statusCode, 401);
  } finally {
    await Promise.all([app.close(), off.close(), tight.close()]);
    await c.db.delete(gradeEntries).where(inArray(gradeEntries.studentId, ids));
    await c.db.delete(teachingAssignments).where(inArray(teachingAssignments.teacherId, ids));
    await c.db.delete(subjects).where(inArray(subjects.id, subjectIds));
    await c.db.delete(users).where(inArray(users.id, ids));
    await c.db.delete(groups).where(inArray(groups.id, groupIds));
    await c.close();
  }
});
