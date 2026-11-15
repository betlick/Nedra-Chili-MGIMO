import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { notifications, pushSubscriptions, userPrefs } from './schema.js';
import { bodyObject, fail, uuid, type Authorize, type Db } from './domain.js';
import { validEndpoint, validKey, type PushService } from './push.js';
export function notificationRoutes(app: FastifyInstance, db: Db, auth: Authorize, push: PushService) {
    app.get('/api/push/config', async (req, reply) => {
        const id = await auth(req, reply);
        if (id) return { data: { enabled: push.enabled, publicKey: push.publicKey } };
    });
    app.post('/api/push/subscriptions', async (req, reply) => {
        const id = await auth(req, reply);
        if (!id) return;
        if (!push.enabled) fail(503, 'Push-уведомления не настроены');
        const sub = bodyObject(req.body), keys = bodyObject(sub.keys);
        if (Object.keys(sub).some(k => !['endpoint', 'keys'].includes(k)) ||
            Object.keys(keys).some(k => !['p256dh', 'auth'].includes(k)) ||
            !validEndpoint(sub.endpoint) || !validKey(keys.p256dh, 65, 65) || !validKey(keys.auth, 16, 32))
            fail(400, 'Неверная подписка браузера');
        await db.insert(pushSubscriptions).values({ endpoint: sub.endpoint, userId: id, p256dh: keys.p256dh, auth: keys.auth })
            .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: id, p256dh: keys.p256dh, auth: keys.auth } });
        return reply.code(204).send();
    });
    app.delete('/api/push/subscriptions', async (req, reply) => {
        const id = await auth(req, reply);
        if (!id) return;
        const { endpoint } = bodyObject(req.body);
        if (!validEndpoint(endpoint)) fail(400, 'Неверная подписка браузера');
        await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, id), eq(pushSubscriptions.endpoint, endpoint)));
        return reply.code(204).send();
    });
    app.get('/api/notifications', async (req, reply) => {
        const id = await auth(req, reply);
        if (!id)
            return;
        return { data: await db.select().from(notifications).where(eq(notifications.studentId, id)).orderBy(desc(notifications.createdAt), desc(notifications.id)) };
    });
    app.patch('/api/notifications/read-all', async (req, reply) => {
        const id = await auth(req, reply);
        if (!id)
            return;
        await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.studentId, id));
        return reply.code(204).send();
    });
    app.patch<{
        Params: {
            id: string;
        };
    }>('/api/notifications/:id/read', async (req, reply) => {
        const id = await auth(req, reply);
        if (!id)
            return;
        const [row] = await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, uuid(req.params.id)), eq(notifications.studentId, id))).returning();
        if (!row)
            fail(404, 'Уведомление не найдено');
        return { data: row };
    });
    const readPrefs = async (id: string) => (await db.select({ deadlines: userPrefs.deadlines, schedule: userPrefs.schedule, news: userPrefs.news }).from(userPrefs).where(eq(userPrefs.userId, id)))[0] ?? { deadlines: true, schedule: true, news: false };
    app.get('/api/user/prefs', async (req, reply) => { const id = await auth(req, reply); if (id)
        return { data: await readPrefs(id) }; });
    app.patch('/api/user/prefs', async (req, reply) => {
        const id = await auth(req, reply);
        if (!id)
            return;
        const body = bodyObject(req.body);
        if (!Object.keys(body).length || Object.entries(body).some(([k, v]) => !['deadlines', 'schedule', 'news'].includes(k) || typeof v !== 'boolean'))
            fail(400, 'Неверные настройки');
        const values = body as Partial<{
            deadlines: boolean;
            schedule: boolean;
            news: boolean;
        }>;
        await db.insert(userPrefs).values({ userId: id, ...values }).onConflictDoUpdate({ target: userPrefs.userId, set: values });
        return { data: await readPrefs(id) };
    });
}
