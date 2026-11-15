import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { hash } from 'argon2';
import { eq, inArray } from 'drizzle-orm';
import * as webpush from 'web-push';
import { buildApp } from '../src/app.js';
import { connectDatabase } from '../src/db.js';
import { groups, pushSubscriptions, users } from '../src/schema.js';
import { validEndpoint } from '../src/push.js';

test('push subscriptions: CSRF, endpoint validation, transfer to current user and ownership', async () => {
  assert.equal(validEndpoint('https://fcm.googleapis.com/fcm/send/demo'), true);
  for (const endpoint of ['http://fcm.googleapis.com/a', 'https://localhost/a', 'https://fcm.googleapis.com.evil.test/a', 'https://127.0.0.1/a']) {
    assert.equal(validEndpoint(endpoint), false);
  }
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = 'mailto:demo@example.com';
  const db = connectDatabase();
  const app = buildApp({ logger: false, origin: 'http://localhost:5173', secureCookies: false });
  const suffix = randomUUID(), groupId = randomUUID(), ids = [randomUUID(), randomUUID()];
  const password = randomBytes(20).toString('hex'), passwordHash = await hash(password);
  const headers = { origin: 'http://localhost:5173', 'x-csrf-protection': '1' };
  const endpoint = 'https://fcm.googleapis.com/fcm/send/' + suffix;
  const subscription = { endpoint, keys: { p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString('base64url'), auth: randomBytes(16).toString('base64url') } };
  try {
    await db.db.insert(groups).values({ id: groupId, name: `PUSH-${suffix}`, faculty: 'Тест', program: 'Тест', year: 1 });
    await db.db.insert(users).values(ids.map((id, i) => ({ id, role: 'student', email: `push-${suffix}-${i}@example.com`, fullName: 'Тестовый пользователь', faculty: 'Тест', groupId, passwordHash })));
    const cookies = [];
    for (let i = 0; i < 2; i++) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { email: `push-${suffix}-${i}@example.com`, password } });
      assert.equal(response.statusCode, 200);
      cookies.push(String(response.headers['set-cookie']).split(';')[0]!);
    }
    const call = (i: number, method: 'POST' | 'DELETE', payload: object, csrf = true) => app.inject({ method, url: '/api/push/subscriptions', headers: { cookie: cookies[i], ...(csrf ? headers : {}) }, payload });
    assert.equal((await app.inject({ method: 'GET', url: '/api/push/config', headers: { cookie: cookies[0] } })).json().data.publicKey, keys.publicKey);
    assert.equal((await call(0, 'POST', subscription, false)).statusCode, 403);
    assert.equal((await call(0, 'POST', { ...subscription, endpoint: 'https://localhost/private' })).statusCode, 400);
    assert.equal((await call(0, 'POST', subscription)).statusCode, 204);
    assert.equal((await call(1, 'DELETE', { endpoint })).statusCode, 204);
    assert.equal((await db.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)))[0]!.userId, ids[0]);
    assert.equal((await call(1, 'POST', subscription)).statusCode, 204);
    assert.equal((await db.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)))[0]!.userId, ids[1]);
    assert.equal((await call(1, 'DELETE', { endpoint })).statusCode, 204);
    assert.equal((await db.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))).length, 0);
  } finally {
    await app.close();
    await db.db.delete(users).where(inArray(users.id, ids));
    await db.db.delete(groups).where(eq(groups.id, groupId));
    await db.close();
    delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; delete process.env.VAPID_SUBJECT;
  }
});
