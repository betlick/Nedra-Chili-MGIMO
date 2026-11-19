import { useState } from 'react'
import { useData } from '../context/data'
import { useToast } from '../context/toast'
import { dataApi, type ApiAssignment } from '../lib/api'
import { Badge, Button } from './ui'

const STATUS = { new: 'Новое', progress: 'В работе', closed: 'Закрыто' } as const
const TONE = { new: 'accent', progress: 'warn', closed: 'ok' } as const
const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Мои обращения к преподавателям: переписка по каждому обращению и ответ внутри карточки. */
export function InquiryThreads({ teachers }: { teachers: ApiAssignment[] }) {
  const { inquiries, reload } = useData()
  const toast = useToast()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [sending, setSending] = useState<string | null>(null)
  const [error, setError] = useState('')

  const send = async (id: string) => {
    const message = drafts[id]?.trim()
    if (!message || sending) return
    setSending(id)
    setError('')
    try {
      await dataApi.replyInquiry(id, message)
      setDrafts((p) => ({ ...p, [id]: '' }))
      await reload()
      toast('Ответ отправлен')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить ответ. Попробуйте ещё раз.')
    } finally {
      setSending(null)
    }
  }

  if (!inquiries.length)
    return (
      <div className="thread-empty">
        <b>Обращений пока нет</b>
        <p className="muted">Напишите преподавателю через форму слева: ответ появится здесь.</p>
      </div>
    )

  return (
    <div className="stack">
      {error && <p role="alert" className="form-error">{error}</p>}
      {inquiries.map((q) => {
        const a = teachers.find((t) => t.id === q.assignmentId)
        const teacherName = a?.teacher ?? 'Преподаватель'
        return (
          <article key={q.id} className="req thread">
            <div className="req__head">
              <h3>{q.subject}</h3>
              <Badge tone={TONE[q.status]}>{STATUS[q.status]}</Badge>
            </div>
            {a && <p className="small muted">{a.teacher} · {a.subject}</p>}
            <ul className="thread__msgs" aria-label={`Переписка: ${q.subject}`}>
              <li className="msg msg--me"><p>{q.message}</p></li>
              {q.replies.map((r) => {
                const mine = r.authorId === q.studentId
                return (
                  <li key={r.id} className={`msg ${mine ? 'msg--me' : ''}`}>
                    <span className="msg__who">{mine ? 'Вы' : teacherName} · {when(r.createdAt)}</span>
                    <p>{r.text}</p>
                  </li>
                )
              })}
            </ul>
            {q.status === 'closed' ? (
              <p className="small muted">Обращение закрыто. Преподаватель может открыть его снова.</p>
            ) : (
              <div className="thread__reply">
                <label className="field__label" htmlFor={`reply-${q.id}`}>Ваш ответ</label>
                <textarea
                  id={`reply-${q.id}`}
                  className="input textarea"
                  rows={2}
                  maxLength={5000}
                  value={drafts[q.id] ?? ''}
                  onChange={(e) => setDrafts((p) => ({ ...p, [q.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(q.id) }}
                />
                <Button variant="primary" disabled={!drafts[q.id]?.trim() || !!sending} onClick={() => void send(q.id)}>
                  {sending === q.id ? 'Отправляем…' : 'Отправить ответ'}
                </Button>
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
