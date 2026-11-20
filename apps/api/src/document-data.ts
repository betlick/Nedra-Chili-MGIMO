import { eq } from 'drizzle-orm';
import { fail, type DbSession } from './domain.js';
import { groups, studentDocumentProfiles, subjects, teachingAssignments, users } from './schema.js';

/** Trusted database context for future template filling; never a model's output. */
export async function documentData(db: DbSession, studentId: string) {
  const [student] = await db.select({ fullName: users.fullName, faculty: users.faculty,
    groupId: users.groupId, groupName: groups.name, program: groups.program, year: groups.year })
    .from(users).leftJoin(groups, eq(groups.id, users.groupId)).where(eq(users.id, studentId));
  if (!student) fail(404, 'Студент не найден');
  const [stored] = await db.select().from(studentDocumentProfiles).where(eq(studentDocumentProfiles.studentId, studentId));
  const profile = stored ? {
    birthDate: stored.birthDate, studyForm: stored.studyForm, fundingBasis: stored.fundingBasis,
    enrollmentDate: stored.enrollmentDate, enrollmentOrder: stored.enrollmentOrder,
    expectedGraduationDate: stored.expectedGraduationDate, phone: stored.phone,
    enrollmentStatus: stored.enrollmentStatus, source: stored.source,
  } : null;
  const missing = Object.entries({ fullName: student.fullName, faculty: student.faculty,
    groupName: student.groupName, program: student.program, year: student.year,
    birthDate: profile?.birthDate, studyForm: profile?.studyForm, fundingBasis: profile?.fundingBasis,
    enrollmentDate: profile?.enrollmentDate, enrollmentOrder: profile?.enrollmentOrder,
    expectedGraduationDate: profile?.expectedGraduationDate, phone: profile?.phone,
    enrollmentStatus: profile?.enrollmentStatus,
  }).filter(([, value]) => value == null || (typeof value === 'string' && !value.trim())).map(([key]) => key);
  const assignments = student.groupId ? await db.select({ id: teachingAssignments.id,
    subject: subjects.name, teacher: users.fullName, semester: teachingAssignments.semester, form: teachingAssignments.form })
    .from(teachingAssignments).innerJoin(subjects, eq(subjects.id, teachingAssignments.subjectId))
    .innerJoin(users, eq(users.id, teachingAssignments.teacherId))
    .where(eq(teachingAssignments.groupId, student.groupId)).orderBy(teachingAssignments.semester, subjects.name) : [];
  return {
    student: { fullName: student.fullName, faculty: student.faculty, groupName: student.groupName, program: student.program, year: student.year },
    profile, missing,
    assignments: assignments.map(a => {
      const startYear = profile ? Number(profile.enrollmentDate.slice(0, 4)) + Math.floor((a.semester - 1) / 2) : null;
      return { ...a, academicYear: startYear === null ? null : `${startYear}/${startYear + 1}` };
    }),
  };
}

// Deliberately limited to the two original demo logins and their demo groups.
export async function seedDocumentProfiles(db: DbSession) {
  let inserted = 0;
  const fixtures = [
    { email: 'student@edu.mukpid.ru', groupName: 'ДЕМО-МО-101', birthDate: '2008-02-14',
      enrollmentDate: '2026-08-25', enrollmentOrder: 'ДЕМО-2026-101', expectedGraduationDate: '2030-06-30',
      fundingBasis: 'Бюджетная основа (демо)', phone: '+7 (000) 000-00-01' },
    { email: 'student2@edu.mukpid.ru', groupName: 'ДЕМО-ЭК-202', birthDate: '2007-07-03',
      enrollmentDate: '2025-08-25', enrollmentOrder: 'ДЕМО-2025-202', expectedGraduationDate: '2029-06-30',
      fundingBasis: 'Договорная основа (демо)', phone: '+7 (000) 000-00-02' },
  ];
  for (const { email, groupName, ...data } of fixtures) {
    const [student] = await db.select({ id: users.id, role: users.role, groupName: groups.name })
      .from(users).innerJoin(groups, eq(groups.id, users.groupId)).where(eq(users.email, email));
    if (!student || student.role !== 'student' || student.groupName !== groupName) {
      throw new Error('Expected demo student/group missing; document seed rolled back');
    }
    const rows = await db.insert(studentDocumentProfiles).values({ studentId: student.id, ...data,
      studyForm: 'Очная', enrollmentStatus: 'active', source: 'demo' }).onConflictDoNothing().returning({ id: studentDocumentProfiles.studentId });
    inserted += rows.length;
  }
  return inserted;
}
