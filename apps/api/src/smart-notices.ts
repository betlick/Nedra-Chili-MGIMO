import { requestNotice as formatRequestNotice } from './request-notice.js';
import { REQUEST_TYPE_LABELS } from './request-types.js';
const statuses: Record<string, string> = { submitted: 'Принята', in_progress: 'В работе', ready: 'Готова', issued: 'Выдана', cancelled: 'Отменена', rejected: 'Отклонена' };
export function requestNotice(row: { id: string; type: string; delivery: string }, from: string | null, to: string, reason?: string) {
  const label = REQUEST_TYPE_LABELS[row.type as keyof typeof REQUEST_TYPE_LABELS] ?? row.type;
  const notice = to === 'cancelled'
    ? {title:'Заявка отменена',body:`«${label}».`}
    : formatRequestNotice(row, to as 'submitted'|'in_progress'|'ready'|'issued'|'rejected', reason);
  return {kind:'request', title:notice.title, body:`${notice.body} № ${row.id}. Статус: ${from ? `${statuses[from] ?? from} → ` : ''}${statuses[to] ?? to}.`};
}
type Slot = { subject: string; startsAt: Date; endsAt: Date; room: string; teacherName: string; kind: string; changeNote?: string | null };
const date = (d: Date) => d.toLocaleString('ru-RU', {timeZone:'Europe/Moscow', day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
export function lessonDescription(s: Slot) {
  const kind = ({lecture:'Лекция',seminar:'Семинар',practice:'Практика'} as Record<string,string>)[s.kind] ?? s.kind;
  return `${kind} «${s.subject}»: ${date(s.startsAt)}–${s.endsAt.toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'})} МСК; ${s.room}; ${s.teacherName}`;
}
export function lessonChange(before: Slot, after: Slot) {
  const changes: string[] = [];
  if (+before.startsAt !== +after.startsAt || +before.endsAt !== +after.endsAt) changes.push(`Время: ${date(before.startsAt)}–${date(before.endsAt)} → ${date(after.startsAt)}–${date(after.endsAt)} МСК`);
  if (before.room !== after.room) changes.push(`Аудитория: ${before.room} → ${after.room}`);
  if (before.teacherName !== after.teacherName) changes.push(`Преподаватель: ${before.teacherName} → ${after.teacherName}`);
  if (before.subject !== after.subject) changes.push(`Дисциплина: ${before.subject} → ${after.subject}`);
  if (before.kind !== after.kind) changes.push(`Вид: ${before.kind} → ${after.kind}`);
  if (before.changeNote !== after.changeNote) changes.push(`Комментарий: ${after.changeNote || 'удалён'}`);
  return changes.length ? `${lessonDescription(before)}. ${changes.join('. ')}.` : null;
}
