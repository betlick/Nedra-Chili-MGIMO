import { eq } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { fail, type DbSession } from './domain.js';
import { groups, users, studentDocumentProfiles, teachingAssignments, subjects, type DocumentSnapshot, type requests } from './schema.js';
import { REQUEST_TYPE_IDS } from './request-types.js';

export const isTemplateType = (type: string): type is 'study' | 'retake' => type === 'study' || type === 'retake';
const assets = new URL('../assets/request-templates/', import.meta.url);
export const sameSnapshot = (a: DocumentSnapshot | null, b: DocumentSnapshot) => isDeepStrictEqual(a, b);

export async function originalTemplate(type: string) {
  if (type === 'other' || !REQUEST_TYPE_IDS.includes(type as typeof REQUEST_TYPE_IDS[number])) fail(404, 'Бланк не найден');
  return readFile(new URL(`original/${type}.docx`, assets));
}

const template = (type: 'study' | 'retake') => readFile(new URL(`fillable/${type}.docx`, assets));
export async function documentFieldNames(type: 'study' | 'retake') {
  const xml = strFromU8(unzipSync(await template(type))['word/document.xml']!);
  return [...new Set([...xml.matchAll(/\{\{([A-Z_]+)\}\}/g)].map(m => m[1]!))].sort();
}
const ruDate = (date: string | Date) => new Date(typeof date === 'string' ? date + 'T12:00:00Z' : date)
  .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });

/** Lock source rows so facts cannot change while verification/issuance commits. */
export type DocumentInput = Pick<typeof requests.$inferSelect, 'studentId'|'type'|'assignmentId'|'purpose'|'createdAt'|'aiPurpose'>;
export async function documentSnapshot(db: DbSession, row: DocumentInput): Promise<DocumentSnapshot> {
  if (!isTemplateType(row.type)) fail(409, 'Для этой темы нет автоматического заполнения');
  const [u] = await db.select().from(users).where(eq(users.id, row.studentId)).for('share');
  if (!u || !u.groupId) fail(409, 'Профиль студента или группа не найдены');
  const [g] = await db.select().from(groups).where(eq(groups.id, u.groupId)).for('share');
  const [p] = await db.select().from(studentDocumentProfiles).where(eq(studentDocumentProfiles.studentId, u.id)).for('share');
  const required = { fullName: u.fullName, faculty: u.faculty, program: g?.program, year: g?.year, groupName: g?.name,
    birthDate: p?.birthDate, studyForm: p?.studyForm, fundingBasis: p?.fundingBasis, enrollmentDate: p?.enrollmentDate,
    enrollmentOrder: p?.enrollmentOrder, expectedGraduationDate: p?.expectedGraduationDate, phone: p?.phone, purpose: row.purpose };
  const missing = Object.entries(required).filter(([, value]) => value == null || (typeof value === 'string' && !value.trim())).map(([key]) => key);
  if (missing.length) fail(409, 'Заполните учебные сведения: ' + missing.join(', '));
  if (p!.enrollmentStatus !== 'active') fail(409, 'Нужно подтверждение действующего статуса обучения');
  const forms: Record<string, string> = { 'очная': 'очной', 'очно-заочная': 'очно-заочной', 'заочная': 'заочной' };
  const studyForm = forms[p!.studyForm.toLowerCase().trim()];
  if (!studyForm) fail(409, 'Уточните форму обучения в профиле');
  const fields: Record<string, string> = {
    FULL_NAME: u.fullName, FACULTY: u.faculty, PROGRAM: g!.program, YEAR: String(g!.year), GROUP_NAME: g!.name,
    BIRTH_DATE: ruDate(p!.birthDate), STUDY_FORM_GENITIVE: studyForm, FUNDING_BASIS: p!.fundingBasis,
    ENROLLMENT_DATE: ruDate(p!.enrollmentDate), ENROLLMENT_ORDER: p!.enrollmentOrder,
    GRADUATION_DATE: ruDate(p!.expectedGraduationDate), PHONE: p!.phone, PURPOSE: row.aiPurpose ?? row.purpose,
    APPLICATION_DATE: ruDate(row.createdAt), PROFILE_SOURCE: p!.source,
  };
  if (row.type === 'retake') {
    if (!row.assignmentId) fail(409, 'Выберите дисциплину для пересдачи');
    const [a] = await db.select({ groupId: teachingAssignments.groupId, semester: teachingAssignments.semester,
      form: teachingAssignments.form, subject: subjects.name, teacher: users.fullName }).from(teachingAssignments)
      .innerJoin(subjects, eq(subjects.id, teachingAssignments.subjectId)).innerJoin(users, eq(users.id, teachingAssignments.teacherId))
      .where(eq(teachingAssignments.id, row.assignmentId)).for('share');
    if (!a || a.groupId !== u.groupId) fail(409, 'Дисциплина не относится к текущей группе студента');
    const start = Number(p!.enrollmentDate.slice(0, 4)) + Math.floor((a.semester - 1) / 2);
    Object.assign(fields, { SUBJECT: a.subject, TEACHER: a.teacher, SEMESTER: String(a.semester),
      ACADEMIC_YEAR: `${start}/${start + 1}`, ASSESSMENT_GENITIVE: a.form === 'Экзамен' ? 'экзамена' : 'зачёта', ASSIGNMENT_ID: row.assignmentId });
  }
  const hash = createHash('sha256').update(await template(row.type)).digest('hex').slice(0, 16);
  return { fullName: u.fullName, faculty: u.faculty, program: g!.program, year: g!.year, groupName: g!.name,
    purpose: row.purpose, templateVersion: `${row.type}-original-${hash}`, documentType: row.type, fields };
}

/** Replace only tokens inside existing text runs; no rebuilding of the document. */
export async function filledDocx(snapshot: DocumentSnapshot): Promise<Buffer> {
  if (!snapshot.documentType || !snapshot.fields) fail(409, 'Подготовьте документ заново');
  const parts = unzipSync(await template(snapshot.documentType));
  const xml = strFromU8(parts['word/document.xml']!);
  const escape = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+/g, ' ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  parts['word/document.xml'] = strToU8(xml.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => {
    const value = snapshot.fields![key];
    if (typeof value !== 'string' || !value.trim()) fail(409, 'Не заполнено поле документа: ' + key);
    return escape(value);
  }));
  return Buffer.from(zipSync(parts));
}
