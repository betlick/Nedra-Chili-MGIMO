import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { connectDatabase } from '../src/db.js';
import { documentData, seedDocumentProfiles } from '../src/document-data.js';
import { groups, studentDocumentProfiles, subjects, teachingAssignments, users } from '../src/schema.js';

test('document data: demo seed is idempotent, preserves edits and uses only group assignments', async () => {
  const c = connectDatabase();
  const rollback = new Error('rollback successful test');
  try {
    await assert.rejects(c.db.transaction(async tx => {
      const students: string[] = [];
      const groupIds: string[] = [];
      for (const [i, name] of ['ДЕМО-МО-101', 'ДЕМО-ЭК-202'].entries()) {
        const [g] = await tx.insert(groups).values({ name, faculty: 'Демо', program: 'Демо', year: i + 1 }).returning();
        groupIds.push(g!.id);
        const [u] = await tx.insert(users).values({ email: i ? 'student2@edu.mukpid.ru' : 'student@edu.mukpid.ru',
          fullName: `Демостудент ${i}`, faculty: 'Демо', groupId: g!.id, passwordHash: 'unused-test-hash' }).returning();
        students.push(u!.id);
      }
      assert.equal(await seedDocumentProfiles(tx), 2);
      await tx.update(studentDocumentProfiles).set({ enrollmentOrder: 'ДЕМО-ИСПРАВЛЕНО' }).where(eq(studentDocumentProfiles.studentId, students[0]!));
      assert.equal(await seedDocumentProfiles(tx), 0);
      assert.equal((await documentData(tx, students[0]!)).profile?.enrollmentOrder, 'ДЕМО-ИСПРАВЛЕНО');
      const [teacher] = await tx.insert(users).values({ email: `${randomUUID()}@example.test`, fullName: 'Демо преподаватель', faculty: 'Демо', role: 'teacher', passwordHash: 'unused' }).returning();
      const [subject] = await tx.insert(subjects).values({ name: 'Тестовая дисциплина' }).returning();
      await tx.insert(teachingAssignments).values(groupIds.map((groupId, i) => ({ groupId, subjectId: subject!.id, teacherId: teacher!.id, semester: i * 2 + 1, form: 'Экзамен' })));
      const first = await documentData(tx, students[0]!);
      const second = await documentData(tx, students[1]!);
      assert.deepEqual(first.missing, []);
      assert.deepEqual(second.missing, []);
      assert.equal(first.assignments.length, 1);
      assert.equal(second.assignments.length, 1);
      assert.notEqual(first.assignments[0]!.id, second.assignments[0]!.id);
      assert.equal(first.assignments[0]!.academicYear, '2026/2027');
      assert.equal(second.assignments[0]!.academicYear, '2026/2027');
      assert.equal(first.assignments[0]!.teacher, 'Демо преподаватель');
      // A second student in the same group does not inherit the primary student's profile.
      const [other] = await tx.insert(users).values({ email: `${randomUUID()}@example.test`, fullName: 'Другой демостудент', faculty: 'Демо', groupId: groupIds[0], passwordHash: 'unused' }).returning();
      assert.equal((await documentData(tx, other!.id)).profile, null);
      throw rollback;
    }), error => error === rollback);
  } finally {
    await c.close();
  }
});
