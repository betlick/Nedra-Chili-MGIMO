import { REQUEST_TYPE_LABELS } from './request-types.js';

/**
 * Тексты уведомлений о заявках. Шаблоны: уведомление пишется в той же транзакции, что и смена статуса.
 * Номер — первые 4 символа id, как в кабинете сотрудника (apps/web/src/lib/staff.ts, shortNumber).
 */
export const requestNumber = (id: string) => id.slice(0, 4).toUpperCase();
/** Название без уточнения в скобках: «Справка для военкомата (Приложение № 4)» → «Справка для военкомата». */
const label = (type: string) => ((REQUEST_TYPE_LABELS as Record<string, string>)[type] ?? 'Заявка').replace(/\s*\(.*\)$/, '');
/** «Справка … готова» звучит естественно только для справок и копий; для остальных — «Заявка № … готова». */
const subject = (type: string, n: string) => /^(Справка|Академическая справка|Копия)/.test(label(type)) ? `${label(type)} № ${n}` : `Заявка № ${n}`;

type Row = { id: string; type: string; delivery: string };
export function requestNotice(row: Row, event: 'submitted' | 'in_progress' | 'ready' | 'issued' | 'rejected', reason?: string) {
  const n = requestNumber(row.id), name = label(row.type), head = subject(row.type, n);
  switch (event) {
    case 'submitted': return { title: `Заявка № ${n} принята`, body: `${name}. Деканат получил заявку, о каждом шаге сообщим здесь.` };
    case 'in_progress': return { title: `Заявка № ${n} взята в работу`, body: `${name}. Сообщим, когда будет готово.` };
    case 'ready': return row.delivery === 'pdf'
      ? { title: `${head} готова — PDF можно скачать`, body: `${name}. Файл в разделе «Заявки».` }
      : { title: `${head} готова — заберите в деканате`, body: `${name}. Документ ждёт вас в учебном офисе.` };
    case 'issued': return { title: `${head} выдана`, body: `${name}. Заявка закрыта.` };
    case 'rejected': return { title: `Заявка № ${n} отклонена`, body: `${name}. Причина: ${reason ?? 'не указана'}` };
  }
}
export const typeChangeNotice = (row: Row, from: string) => ({
  title: `Вид заявки № ${requestNumber(row.id)} уточнён`,
  body: `Деканат изменил вид с «${label(from)}» на «${label(row.type)}».`,
});
