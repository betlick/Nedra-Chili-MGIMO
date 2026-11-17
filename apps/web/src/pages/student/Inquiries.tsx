import { useEffect, useState, type FormEvent } from 'react';
import { useData } from '../../context/data';
import { dataApi, type ApiAssignment } from '../../lib/api';
import { Badge, Button, PageHeader, ThemeButton } from '../../components/ui';
const status = { new: 'Новое', progress: 'В работе', closed: 'Закрыто' };
export function StudentInquiriesPage() {
    const { inquiries, reload } = useData();
    const [teachers, setTeachers] = useState<ApiAssignment[]>([]), [assignmentId, setAssignment] = useState(''), [subject, setSubject] = useState(''), [text, setText] = useState('');
    const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
    const [replyText, setReplyText] = useState<Record<string, string>>({});
    const [sending, setSending] = useState<string | null>(null);
    useEffect(() => { let live = true; dataApi.inquiryTeachers().then(rows => { if (live)
        setTeachers(rows); }).catch(e => { if (live)
        setError(e.message); }); return () => { live = false; }; }, []);
    const teacherOf = (id?: string) => teachers.find(a => a.id === id);
    const submit = async (e: FormEvent) => { e.preventDefault(); if (busy)
        return; setBusy(true); setError(null); try {
        await dataApi.addInquiry(assignmentId || teachers[0]?.id, subject, text);
        setSubject('');
        setText('');
        await reload();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Не удалось отправить');
    }
    finally {
        setBusy(false);
    } };
    const sendReply = async (id: string) => {
        const message = replyText[id]?.trim();
        if (!message || sending) return;
        setSending(id); setError(null);
        try {
            await dataApi.replyInquiry(id, message);
            setReplyText(prev => ({ ...prev, [id]: '' }));
            await reload();
        } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось отправить ответ'); }
        finally { setSending(null); }
    };
    return <><PageHeader title="Обращения преподавателям" eyebrow="Вопросы и ответы" actions={<ThemeButton />}/>{error && <p role="alert" className="form-error">{error}</p>}
    <div className="grid-half"><form className="card stack" onSubmit={submit}><h2 className="card__title">Новое обращение</h2>
      <label className="field">Преподаватель и дисциплина<select required className="input" value={assignmentId || teachers[0]?.id || ''} onChange={e => setAssignment(e.target.value)}>{teachers.map(a => <option key={a.id} value={a.id}>{a.teacher} · {a.subject} · семестр {a.semester}</option>)}</select></label>
      {!teachers.length && <p className="muted">Для вашей группы пока нет назначенных преподавателей.</p>}
      <label className="field">Тема<input required className="input" maxLength={200} value={subject} onChange={e => setSubject(e.target.value)}/></label>
      <label className="field">Сообщение<textarea required className="input textarea" rows={5} maxLength={5000} value={text} onChange={e => setText(e.target.value)}/></label>
      <Button type="submit" disabled={busy || !teachers.length}>{busy ? 'Отправляем…' : 'Отправить'}</Button>
    </form><section className="card stack"><h2 className="card__title">Мои обращения</h2>{!inquiries.length && <p className="muted">Обращений пока нет.</p>}{inquiries.map(q => <article className="req" key={q.id}><div className="req__head"><h3>{q.subject}</h3><Badge>{status[q.status]}</Badge></div>{teacherOf(q.assignmentId) && <p className="small muted">Кому: {teacherOf(q.assignmentId)!.teacher} · {teacherOf(q.assignmentId)!.subject}</p>}<p style={{ whiteSpace: 'pre-wrap' }}>{q.message}</p>{q.replies.map(r => <blockquote key={r.id} style={{ whiteSpace: 'pre-wrap' }} className="req__comment"><b>{r.authorId === q.studentId ? 'Вы' : teacherOf(q.assignmentId)?.teacher ?? 'Преподаватель'}</b> <span className="small muted">· {new Date(r.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК</span><br />{r.text}</blockquote>)}{q.status === 'closed' ? <p className="small muted">Обращение закрыто. Преподаватель может открыть его снова.</p> : <div className="field"><label className="field__label" htmlFor={`reply-${q.id}`}>Продолжить диалог</label><textarea id={`reply-${q.id}`} className="input textarea" maxLength={5000} rows={3} value={replyText[q.id] ?? ''} onChange={e => setReplyText(prev => ({ ...prev, [q.id]: e.target.value }))} /><Button type="button" disabled={!replyText[q.id]?.trim() || !!sending} onClick={() => void sendReply(q.id)}>{sending === q.id ? 'Отправляем…' : 'Ответить'}</Button></div>}</article>)}</section></div>
  </>;
}
