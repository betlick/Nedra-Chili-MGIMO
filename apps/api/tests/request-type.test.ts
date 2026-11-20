import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { hash } from 'argon2';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { connectDatabase } from '../src/db.js';
import { groups, notifications, requests, users } from '../src/schema.js';

test('staff request type change: roles, allowed statuses, audit fields and notifications with a request link', async () => {
  const c = connectDatabase();
  const origin = 'http://localhost:5173', csrf = { 'x-csrf-protection': '1', origin };
  const app = buildApp({ logger: false, secureCookies: false, origin });
  const suffix = randomUUID(), groupId = randomUUID();
  // 0 — студент, 1 — преподаватель, 2 — сотрудник.
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const password = randomBytes(24).toString('hex'), passwordHash = await hash(password);
  try {
    await c.db.insert(groups).values({ id: groupId, name: `TYPE-${suffix}`, faculty: 'Тест', program: 'Тест', year: 1 });
    await c.db.insert(users).values(ids.map((id, i) => ({ id, email: `type-${suffix}-${i}@example.test`, fullName: `Вымышленный ${i}`, faculty: 'Тест',
      role: i === 2 ? 'staff' : i === 1 ? 'teacher' : 'student', groupId: i === 0 ? groupId : null, passwordHash })));
    const cookies: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: csrf, payload: { email: `type-${suffix}-${i}@example.test`, password } });
      assert.equal(res.statusCode, 200);
      cookies.push(String(res.headers['set-cookie']).split(';')[0]!);
    }
    const as = (i: number) => ({ ...csrf, cookie: cookies[i]! });
    const create = async () => (await app.inject({ method: 'POST', url: '/api/requests', headers: as(0), payload: { type: 'other', purpose: 'Прошу продлить сессию', comment: 'по болезни', delivery: 'pdf' } })).json().data;
    const changeType = (id: string, type: string, i = 2) => app.inject({ method: 'PATCH', url: `/api/staff/requests/${id}/type`, headers: as(i), payload: { type } });
    const setStatus = (id: string, status: string, extra: object = {}) => app.inject({ method: 'PATCH', url: `/api/staff/requests/${id}/status`, headers: as(2), payload: { status, ...extra } });

    const request = await create();
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/staff/requests/${request.id}/type`, payload: { type: 'extension' } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/staff/requests/${request.id}/type`, headers: csrf, payload: { type: 'extension' } })).statusCode, 401);
    assert.equal((await changeType(request.id, 'extension', 0)).statusCode, 403);
    assert.equal((await changeType(request.id, 'extension', 1)).statusCode, 403);
    assert.equal((await changeType(request.id, 'diploma')).statusCode, 400);
    assert.equal((await changeType(randomUUID(), 'extension')).statusCode, 404);
    const changed = await changeType(request.id, 'extension');
    assert.equal(changed.statusCode, 200);
    assert.equal(changed.json().data.type, 'extension');
    assert.equal(changed.json().data.previousType, 'other');
    assert.equal(changed.json().data.typeChangedBy, ids[2]);
    assert(changed.json().data.typeChangedAt);
    assert.equal((await changeType(request.id, 'extension')).statusCode, 200);
    const notes = await c.db.select().from(notifications).where(eq(notifications.studentId, ids[0]!));
    assert.equal(notes.filter(n => n.title.startsWith('Вид заявки')).length, 1, 'repeating the same type does not notify twice');
    assert(notes.every(n => n.requestId === request.id && n.kind === 'request'));

    assert.equal((await setStatus(request.id, 'in_progress')).statusCode, 200);
    assert.equal((await changeType(request.id, 'retake')).statusCode, 200);
    assert.equal((await setStatus(request.id, 'ready')).statusCode, 409, 'retake requires a checked template');
    assert.equal((await changeType(request.id, 'extension')).statusCode, 200);
    assert.equal((await setStatus(request.id, 'ready')).statusCode, 200);
    const number = request.id.slice(0, 4).toUpperCase();
    const titles = (await c.db.select().from(notifications).where(eq(notifications.studentId, ids[0]!))).map(n => n.title);
    assert(titles.includes(`Заявка № ${number} взята в работу`));
    assert(titles.includes(`Заявка № ${number} готова — PDF можно скачать`));
    assert.equal((await changeType(request.id, 'study')).statusCode, 409);
    await setStatus(request.id, 'issued');
    assert.equal((await changeType(request.id, 'study')).statusCode, 409);
    for (const final of ['cancelled', 'rejected']) {
      const r = await create();
      if (final === 'cancelled') await app.inject({ method: 'PATCH', url: `/api/requests/${r.id}/cancel`, headers: as(0) });
      else await setStatus(r.id, 'rejected', { reason: 'Тест' });
      assert.equal((await changeType(r.id, 'study')).statusCode, 409, final);
    }
    const list = (await app.inject({ method: 'GET', url: '/api/notifications', headers: { cookie: cookies[0]! } })).json().data;
    assert(list.some((n: { requestId: string | null }) => n.requestId === request.id));
  } finally {
    await app.close();
    await c.db.delete(notifications).where(inArray(notifications.studentId, ids));
    await c.db.delete(requests).where(inArray(requests.studentId, ids));
    await c.db.delete(users).where(inArray(users.id, ids));
    await c.db.delete(groups).where(inArray(groups.id, [groupId]));
    await c.close();
  }
});
