import * as webpush from 'web-push';
import { and, eq, inArray } from 'drizzle-orm';
import { notifications, pushSubscriptions } from './schema.js';
import type { Db } from './domain.js';

export type PushNotice = Pick<typeof notifications.$inferSelect, 'id' | 'studentId' | 'title' | 'body'>;

export function validEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
       host === 'web.push.apple.com' || host.endsWith('.push.apple.com') ||
       host.endsWith('.notify.windows.com'));
  } catch { return false; }
}

export function validKey(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) &&
    Buffer.from(value, 'base64url').length >= min && Buffer.from(value, 'base64url').length <= max;
}

export function createPush(db: Db, log: { warn: (error: unknown, message: string) => void }) {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  const enabled = Boolean(publicKey && privateKey && subject);
  if (enabled) webpush.setVapidDetails(subject!, publicKey!, privateKey!);

  async function send(rows: PushNotice[]) {
    if (!enabled || !rows.length) return;
    const recipients = [...new Set(rows.map(r => r.studentId))];
    const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, recipients));
    await Promise.all(subs.flatMap(sub => rows.filter(row => row.studentId === sub.userId).map(async row => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ userId: row.studentId, title: row.title, body: row.body, id: row.id }), { TTL: 3600, timeout: 5000 });
      } catch (error) {
        const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : null;
        if (status === 404 || status === 410) await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, sub.endpoint), eq(pushSubscriptions.userId, sub.userId)));
        else log.warn({ status }, 'Web Push delivery failed');
      }
    })));
  }

  return { enabled, publicKey: enabled ? publicKey! : null, send };
}
export type PushService = ReturnType<typeof createPush>;

// Publishing is deliberately best effort. Business transactions have already committed.
export function publishPush(push: PushService, rows: PushNotice[], log: { warn: (error: unknown, message: string) => void }) {
  void push.send(rows).catch(error => log.warn(error, 'Web Push delivery failed'));
}
