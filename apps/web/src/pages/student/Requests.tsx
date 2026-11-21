import { dataApi, downloadFile, type ApiAssignment } from '../../lib/api'
import { STATUS_LABEL } from '../../lib/staff'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useIndicator } from '../../lib/useIndicator'
import { useSmoothHeight } from '../../lib/useSmoothHeight'
import { useData } from '../../context/data'
import { useToast } from '../../context/toast'
import { REQUEST_STAGES, REQUEST_TYPES } from '../../data/mock'
import type { Delivery, RequestType } from '../../types'
import { Badge, Button, Disclaimer, IconButton, PageHeader, Segmented, Stages, ThemeButton } from '../../components/ui'
import { RequestTypePicker } from '../../components/RequestTypePicker'
import { useSearchParams } from 'react-router-dom'
import { InquiryThreads } from '../../components/InquiryThreads'

type Filter = 'all' | 'work' | 'ready'
type Target = 'dean' | 'teacher'

export function RequestsPage() {
  const { requests, addRequest, cancelRequest, unreadCount, reload, inquiries } = useData()
  const toast = useToast()
  const [aiOptions,setAiOptions] = useState<{aiEnabled:boolean;aiTypes:RequestType[]}>({aiEnabled:false,aiTypes:[]})
  useEffect(()=>{let live=true;dataApi.requestOptions().then(v=>{if(live)setAiOptions(v)}).catch(()=>{});return()=>{live=false}},[])
  const [type, setType] = useState<RequestType>('study')
  const [purpose, setPurpose] = useState('')
  const [comment, setComment] = useState('')
  const [delivery, setDelivery] = useState<Delivery>('pdf')
  const [filter, setFilter] = useState<Filter>('all')
  const [error, setError] = useState('')
  // /student/requests?to=teacher открывает вкладку обращений (по этой ссылке приходят из уведомлений и со старой страницы)
  const [target, setTarget] = useState<Target>(() => (new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('to') === 'teacher' ? 'teacher' : 'dean'))
  const [teacher, setTeacher] = useState('')
  const [assignmentId, setAssignmentId] = useState('')
  const [teachers, setTeachers] = useState<ApiAssignment[]>([])
  const [teacherError, setTeacherError] = useState('')
  const [commentError, setCommentError] = useState('')
  useEffect(() => { let live = true; dataApi.inquiryTeachers().then(rows => { if (live) setTeachers(rows) }).catch(e => { if (live) setTeacherError(e instanceof Error ? e.message : 'Не удалось загрузить преподавателей') }); return () => { live = false } }, [])

  const switchTarget = (t: Target) => {
    setTarget(t)
    setError('')
    setTeacherError('')
    setCommentError('')
  }

  const [busy, setBusy] = useState(false)
  // Переход из уведомления: /student/requests?id=… выделяет заявку и прокручивает к ней.
  const [params] = useSearchParams()
  const targetId = params.get('id')
  const toParam = params.get('to')
  useEffect(() => { if (toParam === 'teacher') setTarget('teacher') }, [toParam])
  const scrolledTo = useRef<string | null>(null)
  useEffect(() => {
    if (!targetId || scrolledTo.current === targetId || !requests.some((r) => r.id === targetId)) return
    scrolledTo.current = targetId
    setFilter('all')
    requestAnimationFrame(() => {
      const el = document.getElementById(`req-${targetId}`)
      if (!el) return
      el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
      el.focus({ preventScroll: true })
    })
  }, [targetId, requests])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (target === 'teacher') {
      if (!teacher) return setTeacherError('Выберите дисциплину и преподавателя из списка')
      if (!purpose.trim()) return setError('Укажите тему обращения')
      if (!comment.trim()) return setCommentError('Напишите сообщение преподавателю')
      setBusy(true)
      try {
        await dataApi.addInquiry(teacher, purpose.trim(), comment.trim())
        await reload()
        setPurpose('')
        setComment('')
        setTeacher('')
        setError('')
        toast('Обращение отправлено преподавателю')
      } catch (e) { setCommentError(e instanceof Error ? e.message : 'Не удалось отправить обращение') }
      finally { setBusy(false) }
      return
    }
    if (type === 'retake' && !assignmentId) return setError('Выберите дисциплину для пересдачи')
    if (!purpose.trim()) {
      setError(type === 'other' ? 'Коротко напишите, что нужно' : type === 'retake' ? 'Укажите причину пересдачи' : 'Укажите цель — например, «по месту требования»')
      return
    }
    if (type === 'other' && !comment.trim()) return setCommentError('Опишите, что нужно, — иначе деканат не поймёт обращение')
    setBusy(true)
    const ok = await addRequest({ type, purpose: purpose.trim(), comment: comment.trim(), delivery, ...(type === 'retake' ? {assignmentId} : {}) })
    setBusy(false)
    if (!ok) return
    setPurpose('')
    setComment('')
    setError('')
    toast(`Заявка «${REQUEST_TYPES[type]}» отправлена`)
  }

  const chipsInd = useIndicator<HTMLDivElement>(filter)
  const swapRef = useSmoothHeight(target)
  const shown = requests.filter((r) => (filter === 'all' ? true : filter === 'work' ? ['submitted','in_progress'].includes(r.status) : ['ready','issued'].includes(r.status)))

  return (
    <>
      <PageHeader
        eyebrow="Подача и история заявок"
        title="Заявки и справки"
        actions={
          <>
            <ThemeButton />
            <IconButton icon="bell" label="Уведомления" to="/student/notifications" dot={unreadCount > 0} />
          </>
        }
      />
      <div className="grid-half grid-half--req">
        <form className="card" onSubmit={submit} noValidate>
          <h2 key={target} className="card__title card__title--lg title-swap">{target === 'dean' ? 'Новая заявка' : 'Обращение к преподавателю'}</h2>
          <Segmented
            soft
           
            className="seg--wide"
            label="Кому"
            value={target}
            onChange={switchTarget}
            options={[
              { value: 'dean', label: 'В деканат' },
              { value: 'teacher', label: 'Преподавателю' },
            ]}
          />
          <div ref={swapRef} className="form-swap-wrap">
          <div key={target} className="form-swap">
          {target === 'dean' && (
          <div className="field">
            <span className="field__label" id="req-type-label">Что нужно оформить</span>
            <RequestTypePicker value={type} onChange={setType} labelId="req-type-label" />
            <p className="small muted">{aiOptions.aiEnabled && aiOptions.aiTypes.includes(type)
              ? type === 'study'
                ? delivery === 'pdf' ? 'Справка будет подготовлена автоматически после проверки данных. Если сведений не хватит, заявку рассмотрит сотрудник.' : 'Справка будет подготовлена автоматически, бумажный документ выдаст сотрудник деканата.'
                : 'Заявление будет подготовлено автоматически. Решение о допуске к пересдаче принимает сотрудник.'
              : 'Заявку рассмотрит сотрудник деканата.'}</p>
            {type !== 'other' && <Button variant="ghost" type="button" onClick={() => void downloadFile(`/api/requests/templates/${type}`, `template-${type}.docx`).catch(e => toast(e.message))}>Скачать исходный бланк DOCX</Button>}
          </div>
          )}

          {target === 'dean' && type === 'retake' && <label className="field">
            <span className="field__label">Дисциплина для пересдачи</span>
            <select className="input" value={assignmentId} onChange={e => {setAssignmentId(e.target.value);setError('')}}>
              <option value="">Выберите дисциплину</option>
              {teachers.map(a => <option key={a.id} value={a.id}>{a.subject} · {a.form} · семестр {a.semester} · {a.teacher}</option>)}
            </select>
            {teacherError && <span className="field__error">{teacherError}</span>}
            {!teachers.length && !teacherError && <span className="small muted">Для группы пока нет назначений. Обратитесь в деканат.</span>}
          </label>}
          {target === 'teacher' && (
            <div className="field">
              <label className="field__label" htmlFor="inquiry-assignment">Преподаватель и дисциплина</label>
              <select id="inquiry-assignment" className="input" value={teacher} onChange={e => { setTeacher(e.target.value); setTeacherError('') }}>
                <option value="">Выберите назначение</option>
                {teachers.map(a => <option key={a.id} value={a.id}>{a.teacher} · {a.subject} · семестр {a.semester}</option>)}
              </select>
              {!teachers.length && <span className="small muted">Для вашей группы пока нет назначенных преподавателей.</span>}
              {teacherError && <span className="field__error">{teacherError}</span>}
            </div>
          )}

          <label className="field">
            <span className="field__label">{target === 'teacher' ? 'Тема' : type === 'retake' ? 'Причина пересдачи' : 'Цель'}</span>
            <input
              className={`input ${error ? 'is-invalid' : ''}`}
              placeholder={target === 'teacher' ? 'Например, вопрос по контрольной' : type === 'retake' ? 'Например, ликвидация академической задолженности' : type === 'other' ? 'Коротко: что нужно' : 'Например, для предоставления по месту требования'}
              maxLength={target === 'teacher' ? 200 : 500}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              aria-invalid={!!error}
            />
            {error && <span className="field__error">{error}</span>}
          </label>

          <label className="field">
            <span className="field__label">{target === 'teacher' ? 'Сообщение' : type === 'other' ? 'Опишите обращение' : <>Комментарий <span className="field__opt">— необязательно</span></>}</span>
            <textarea className={`input textarea ${commentError ? 'is-invalid' : ''}`} placeholder={target === 'teacher' ? 'Опишите вопрос или просьбу' : 'Дополнительные сведения'} rows={4} maxLength={target === 'teacher' ? 5000 : 2000} value={comment} onChange={(e) => { setComment(e.target.value); setCommentError('') }} />
            {commentError && <span className="field__error">{commentError}</span>}
          </label>

          {target === 'dean' && (
          <div className="field">
            <span className="field__label" id="req-delivery-label">Как получить</span>
            <Segmented
              soft
             
              className="seg--wide"
              label="Как получить"
              value={delivery}
              onChange={setDelivery}
              options={[
                { value: 'pdf', label: 'PDF' },
                { value: 'office', label: 'Бумажная' },
              ]}
            />
            <span className="small muted">{delivery === 'pdf' ? 'Файл появится в личном кабинете.' : 'Заберёте в деканате.'}</span>
          </div>
          )}
          </div>
          </div>

          <Button disabled={busy} type="submit" variant="primary" size="lg" block>
            {busy ? 'Обрабатываем…' : target === 'teacher' ? 'Отправить обращение' : 'Отправить заявку'}
          </Button>
        </form>

        <section className="card">
          {target === 'teacher' ? (
            <>
              <div className="card__head card__head--wrap">
                <h2 className="card__title card__title--lg">Мои обращения{inquiries.length > 0 && <span className="card__count"> · {inquiries.length}</span>}</h2>
              </div>
              <InquiryThreads teachers={teachers} />
            </>
          ) : (
            <>
          <div className="card__head card__head--wrap">
            <h2 className="card__title card__title--lg">Мои заявки</h2>
            <div ref={chipsInd.box} className="chips" role="radiogroup" aria-label="Фильтр">
              <span ref={chipsInd.ind} className="chips__ind" aria-hidden="true" />
              {(
                [
                  ['all', `Все · ${requests.length}`],
                  ['work', 'В работе'],
                  ['ready', 'Готовы'],
                ] as [Filter, string][]
              ).map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={filter === v} className={`chip ${filter === v ? 'is-active' : ''}`} onClick={() => setFilter(v)}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 && <p className="muted">Здесь пока пусто.</p>}
          <div className="stack">
            {shown.map((r) => (
              <article key={r.id} id={`req-${r.id}`} className={`req ${r.id === targetId ? 'is-target' : ''}`} tabIndex={r.id === targetId ? -1 : undefined} aria-current={r.id === targetId ? 'true' : undefined}>
                <div className="req__head">
                  <h3>{REQUEST_TYPES[r.type]}</h3>
                  <Badge tone={r.stage >= 2 ? 'ok' : 'neutral'}>{STATUS_LABEL[r.status]}</Badge>
                </div>
                <p className="small muted">
                  {r.purpose} · подана {r.createdLabel} · {r.delivery === 'pdf' ? 'PDF' : 'в деканате'}
                </p>
                {r.aiNote && <details><summary>Подсказка ИИ · требует проверки</summary><p style={{whiteSpace:'pre-wrap'}}>{r.aiNote}</p></details>}
                  {!['cancelled','rejected'].includes(r.status) && <Stages stages={REQUEST_STAGES} current={r.stage} />}
                {r.rejectionReason && <p role="alert">Причина отказа: {r.rejectionReason}</p>}
                {r.comment && <blockquote className="req__comment">«{r.comment}»</blockquote>}
                {r.automatedAt && <p className="small">Справка подготовлена автоматически. Реквизиты сверены с учебным профилем.</p>}
                {r.preparedAvailable && <p className="small muted">Заявление подготовлено. Оно ожидает решения сотрудника и не подтверждает допуск к пересдаче.</p>}
                <div className="req__actions">
                  {r.preparedAvailable && <>
                    <Button variant="surface" icon="download" onClick={() => void downloadFile(`/api/requests/${r.id}/prepared/pdf`, 'application-awaiting-decision.pdf').catch(e => toast(e.message))}>Подготовленное заявление PDF</Button>
                    <Button variant="surface" onClick={() => void downloadFile(`/api/requests/${r.id}/prepared/docx`, 'application-awaiting-decision.docx').catch(e => toast(e.message))}>DOCX заявления</Button>
                  </>}
                  {['ready','issued'].includes(r.status) && r.delivery === 'pdf' && (<>
                    <Button variant="primary" icon="download" onClick={() => void downloadFile(`/api/requests/${r.id}/pdf`, `request-${r.id}.pdf`).catch(e => toast(e.message))}>
                      Скачать PDF
                    </Button>
                    {r.docxAvailable && <Button variant="surface" icon="download" onClick={() => void downloadFile(`/api/requests/${r.id}/docx`, `request-${r.id}.docx`).catch(e => toast(e.message))}>Скачать DOCX</Button>}
                  </>)}
                  {['submitted','in_progress'].includes(r.status) && <Button
                    disabled={busy}
                    variant="danger"
                    onClick={async () => {
                      setBusy(true)
                      if (await cancelRequest(r.id)) toast('Заявка отменена')
                      setBusy(false)
                    }}
                  >
                    Отменить заявку
                  </Button>}
                </div>
              </article>
            ))}
          </div>
            </>
          )}
        </section>
      </div>
      <Disclaimer />
    </>
  )
}
