import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

/** Error messages can contain connection details; emit only a bounded, known code. */
export function databaseErrorCode(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return typeof code === 'string' && /^(?:[0-9A-Z]{5}|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN)$/.test(code) ? code : 'DB_CONNECTION_ERROR';
}

export function connectDatabase(options: { onBackgroundError?: (code: string) => void } = {}) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
    keepAlive: true,
  });
  // pg removes a broken idle client itself. Without this listener its error event
  // is uncaught and can terminate the whole server during a network interruption.
  pool.on('error', error => {
    const code = databaseErrorCode(error);
    if (options.onBackgroundError) options.onBackgroundError(code);
    else console.warn('Database background connection error:', code);
  });
  return {
    db: drizzle(pool),
    check: async () => {
      const probe = { text: 'SELECT 1', query_timeout: 3000 };
      await pool.query(probe);
    },
    close: () => pool.end(),
  };
}
