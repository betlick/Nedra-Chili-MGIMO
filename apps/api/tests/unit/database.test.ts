import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { connectDatabase, databaseErrorCode } from '../../src/db.js';
import { buildApp } from '../../src/app.js';

test('idle database connection errors are caught and logged without connection details', async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';
  const codes: string[] = [];
  const connection = connectDatabase({ onBackgroundError: code => codes.push(code) });
  try {
    const pool = connection.db.$client;
    assert.doesNotThrow(() => pool.emit('error', Object.assign(new Error('sensitive connection details'), { code: 'ECONNRESET' })));
    assert.doesNotThrow(() => pool.emit('error', Object.assign(new Error('secret'), { code: 'postgresql://secret' })));
    assert.deepEqual(codes, ['ECONNRESET', 'DB_CONNECTION_ERROR']);
    assert.equal(pool.options.statement_timeout, 15000);
    assert.equal(databaseErrorCode({ code: '57P01' }), '57P01');
    assert.equal(databaseErrorCode(null), 'DB_CONNECTION_ERROR');
  } finally {
    await connection.close();
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
});

test('liveness stays available during database failure and readiness reports 503 without secrets', async () => {
  const previousUrl = process.env.DATABASE_URL, previousSecret = process.env.JWT_SECRET;
  process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';
  process.env.JWT_SECRET = randomBytes(48).toString('hex');
  const app = buildApp({ logger: false, secureCookies: false, origin: 'http://localhost:5173' });
  try {
    const health = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), { status: 'ok' });
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(ready.statusCode, 503);
    assert.deepEqual(ready.json(), { status: 'unavailable' });
    assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
  } finally {
    await app.close();
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
  }
});
