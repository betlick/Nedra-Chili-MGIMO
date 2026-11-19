import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { actor, assignmentAccess, assignmentFilter, assignmentsQuery, bodyObject, fail, studentsOf, textValue, uuid, type Authorize, type Db } from './domain.js';
import { gradeEntries, groups, inquiries, inquiryReplies, lessons, notifications, teachingAssignments, users } from './schema.js';
import { publishPush, type PushNotice, type PushService } from './push.js';
export function academicRoutes(app: FastifyInstance, db: Db, auth: Authorize, push: PushService) {
    app.get('/api/gradebook/groups', async (req, reply) => {
        const id = await auth(req, reply);
        if (!id)
            return;
        const u = await actor(db, id);
        if (u.role !== 'teacher')
            fail(403, 'Ведомости доступны преподавателю');
        const sheets = await assignmentsQuery(db).where(assignmentFilter(u));
        return { data: await Promise.all(sheets.map(async (a) => {
                const students = await studentsOf(db, a.groupId);
                const entries = await db.select().from(gradeEntries).where(eq(gradeEntries.assignmentId, a.id));
                return { ...a, students: students.map(s => ({ ...s, score: entries.find(e => e.studentId === s.id)?.score ?? null })) };
            })) };
    });
    app.put<{
        Params: {
            id: string;
        };
    }>('/api/gradebook/:id', { bodyLimit: 100000 }, async (req, reply) => {
        const id = await auth(req, reply);
        if (!id)
            return;
        const u = await actor(db, id), b = bodyObject(req.body), assignmentId = uuid(req.params.id);
        if (!Number.isInteger(b.version) || (b.version as number) < 0 || !Array.isArray(b.scores) || b.scores.length > 500)
            fail(400, 'Неверная версия или список баллов');
        const scores = b.scores.map(v => { const s = bodyObject(v); const studentId = uuid(s.studentId); if (s.score !== null && (!Number.isInteger(s.score) || (s.score as number) < 0 || (s.score as number) > 100))
            fail(400, 'Баллы: целое 0–100 либо null'); return { studentId, score: s.score as number | null }; });
        if (new Set(scores.map(s => s.studentId)).size !== scores.length)
            fail(400, 'Студент указан несколько раз');
        const pushed: PushNotice[] = [];
        const version = await db.transaction(async (tx) => {
            const [locked] = await tx.select().from(teachingAssignments).where(eq(teachingAssignments.id, assignmentId)).for('update');
            const a = await assignmentAccess(tx, assignmentId, u, true);
            if (a.deadline && a.deadline < new Date())
                fail(409, 'Срок заполнения ведомости истёк');
            if (locked.version !== b.version)
                fail(409, 'Ведомость изменена. Обновите данные перед сохранением');
            const students = await studentsOf(tx, a.groupId);
            if (scores.some(s => !students.some(st => st.id === s.studentId)))
                fail(403, 'В списке есть студент другой группы');
            const existing = await tx.select().from(gradeEntries).where(eq(gradeEntries.assignmentId, a.id));
            for (const s of scores) {
                if ((existing.find(e => e.studentId === s.studentId)?.score ?? null) === s.score)
                    continue;
                await tx.insert(gradeEntries).values({ ...s, assignmentId: a.id }).onConflictDoUpdate({ target: [gradeEntries.assignmentId, gradeEntries.studentId], set: { score: s.score, updatedAt: new Date() } });
                pushed.push(...await tx.insert(notifications).values({ studentId: s.studentId, kind: 'grade', title: 'Оценка обновлена', body: `${a.subject}: ${s.score === null ? 'балл снят' : s.score + ' баллов'}.` }).returning());
            }
            await tx.update(teachingAssignments).set({ version: a.version + 1 }).where(eq(teachingAssignments.id, a.id));
            return a.version + 1;
        });
        publishPush(push, pushed, app.log);
        return { data: { version } };
    });
    app.get('/api/grades', async (req, reply) => {
        const id = await auth(req, reply);
        if (!id)
            return;
        const u = await actor(db, id);
        if (u.role !== 'student')
            fail(403, 'Раздел доступен студенту');
        const assignments = await assignmentsQuery(db).where(assignmentFilter(u));
        const entries = await db.select().from(gradeEntries).where(eq(gradeEntries.studentId, id));
        const scheduled = await db.select({ subjectId: lessons.subjectId, kind: lessons.kind, startsAt: lessons.startsAt })
            .from(lessons).where(and(eq(lessons.groupId, u.groupId!), eq(lessons.cancelled, false)));
        const now = new Date();
        return { data: assignments.map(a => {
            const rows = scheduled.filter(l => l.subjectId === a.subjectId);
            return { id: a.id, name: a.subject, form: a.form, semester: a.semester,
                score: entries.find(e => e.assignmentId === a.id)?.score ?? null,
                lessonCounts: {
                    lectures: rows.filter(l => l.kind === 'lecture').length,
                    lecturesUpcoming: rows.filter(l => l.kind === 'lecture' && l.startsAt > now).length,
                    practices: rows.filter(l => l.kind !== 'lecture').length,
                    practicesUpcoming: rows.filter(l => l.kind !== 'lecture' && l.startsAt > now).length,
                } };
        }) };
    });
    app.get('/api/inquiries/teachers', async (req, reply) => {
        const id = await auth(req, reply);
        if (!id)
            return;
        const u = await actor(db, id);
        if (u.role !== 'student')
            fail(403, 'Раздел доступен студенту');
        return { data: await assignmentsQuery(db).where(assignmentFilter(u)) };
    });
    app.get('/api/inquiries', async (req, reply) => {
        const id = await auth(req, reply);
        if (!id)
            return;
        const u = await actor(db, id);
        if (!['student', 'teacher'].includes(u.role))
            fail(403, 'Нет доступа к обращениям');
        const rows = await db.select({ id: inquiries.id, studentId: inquiries.studentId, teacherId: inquiries.teacherId, assignmentId: inquiries.assignmentId, subject: inquiries.subject, text: inquiries.text, status: inquiries.status, createdAt: inquiries.createdAt, updatedAt: inquiries.updatedAt, student: users.fullName, group: groups.name }).from(inquiries).innerJoin(users, eq(users.id, inquiries.studentId)).leftJoin(groups, eq(groups.id, users.groupId)).where(u.role === 'student' ? eq(inquiries.studentId, id) : eq(inquiries.teacherId, id)).orderBy(desc(inquiries.createdAt));
        const replies = rows.length ? await db.select().from(inquiryReplies).where(inArray(inquiryReplies.inquiryId, rows.map(r => r.id))).orderBy(asc(inquiryReplies.createdAt), asc(inquiryReplies.id)) : [];
        return { data: rows.map(r => ({ ...r, replies: replies.filter(x => x.inquiryId === r.id) })) };
    });
    app.post('/api/inquiries', async (req, reply) => {
        const id = await auth(req, reply);
        if (!id)
            return;
        const u = await actor(db, id);
        if (u.role !== 'student')
            fail(403, 'Обращение создаёт студент');
        const b = bodyObject(req.body), assignmentId = uuid(b.assignmentId), subject = textValue(b.subject, 200, 'Тема'), text = textValue(b.text, 5000, 'Текст');
        const pushed: PushNotice[] = [];
        const row = await db.transaction(async (tx) => {
            const a = await assignmentAccess(tx, assignmentId, u);
            const [r] = await tx.insert(inquiries).values({ studentId: id, teacherId: a.teacherId, assignmentId, subject, text }).returning();
            pushed.push(...await tx.insert(notifications).values({ studentId: a.teacherId, kind: 'inquiry', title: 'Новое обращение', body: subject }).returning());
            return r;
        });
        publishPush(push, pushed, app.log);
        return reply.code(201).send({ data: row });
    });
    app.patch<{
        Params: {
            id: string;
        };
    }>('/api/inquiries/:id', async (req, reply) => {
        const id = await auth(req, reply);
        if (!id)
            return;
        const u = await actor(db, id), b = bodyObject(req.body);
        if (u.role !== 'teacher')
            fail(403, 'Статус меняет преподаватель');
        if (!['progress', 'closed'].includes(String(b.status)))
            fail(400, 'Неверный статус');
        const [r] = await db.update(inquiries).set({ status: b.status as string, updatedAt: new Date() }).where(and(eq(inquiries.id, uuid(req.params.id)), eq(inquiries.teacherId, id))).returning();
        if (!r)
            fail(404, 'Обращение не найдено');
        return { data: r };
    });
    app.post<{
        Params: {
            id: string;
        };
    }>('/api/inquiries/:id/replies', async (req, reply) => {
        const id = await auth(req, reply);
        if (!id)
            return;
        const u = await actor(db, id);
        if (u.role !== 'teacher' && u.role !== 'student')
            fail(403, 'Ответ доступен участникам обращения');
        const text = textValue(bodyObject(req.body).text, 5000, 'Ответ');
        const pushed: PushNotice[] = [];
        const row = await db.transaction(async (tx) => {
            const [r] = await tx.select().from(inquiries).where(and(eq(inquiries.id, uuid(req.params.id)), u.role === 'teacher' ? eq(inquiries.teacherId, id) : eq(inquiries.studentId, id))).for('update');
            if (!r)
                fail(404, 'Обращение не найдено');
            if (r.status === 'closed')
                fail(409, 'Сначала откройте обращение');
            const [answer] = await tx.insert(inquiryReplies).values({ inquiryId: r.id, authorId: id, text }).returning();
            await tx.update(inquiries).set({ status: u.role === 'student' ? 'new' : 'progress', updatedAt: new Date() }).where(eq(inquiries.id, r.id));
            pushed.push(...await tx.insert(notifications).values({ studentId: u.role === 'student' ? r.teacherId : r.studentId, kind: 'inquiry', title: u.role === 'student' ? 'Ответ студента' : 'Ответ преподавателя', body: r.subject }).returning());
            return answer;
        });
        publishPush(push, pushed, app.log);
        return reply.code(201).send({ data: row });
    });
}
