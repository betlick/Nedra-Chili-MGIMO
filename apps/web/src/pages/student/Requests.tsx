import { dataApi, downloadFile, type ApiAssignment } from '../../lib/api'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useSmoothHeight } from '../../lib/useSmoothHeight'
import { useData } from '../../context/data'
import { useToast } from '../../context/toast'
import { REQUEST_TYPES } from '../../data/mock'
import type { Delivery, RequestType } from '../../types'
import { Button, Disclaimer, IconButton, PageHeader, Segmented, ThemeButton } from '../../components/ui'
import { RequestTypePicker } from '../../components/RequestTypePicker'
import { useSearchParams } from 'react-router-dom'
import { InquiryThreads } from '../../components/InquiryThreads'
import { MyRequests } from '../../components/MyRequests'

type Target = 'dean' | 'teacher'

export function RequestsPage() {
  const { requests, addRequest, unreadCount, reload, inquiries } = useData()
  const toast = useToast()
  const [aiOptions,setAiOptions] = useState<{aiEnabled:boolean;aiTypes:RequestType[]}>({aiEnabled:false,aiTypes:[]})
  useEffect(()=>{let live=true;dataApi.requestOptions().then(v=>{if(live)setAiOptions(v)}).catch(()=>{});return()=>{live=false}},[])
  const [type, setType] = useState<RequestType>('study')
  const [purpose, setPurpose] = useState('')
  const [comment, setComment] = useState('')
  const [delivery, setDelivery] = useState<Delivery>('pdf')
  const [expanded, setExpanded] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
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
  const expand = useCallback(() => setExpanded(true), [])
  const collapse = useCallback(() => setExpanded(false), [])
  // «Новая заявка»: вернуться к форме обычного вида и поставить курсор в первое поле
  const startNew = () => {
    setExpanded(false)
    setTarget('dean')
    requestAnimationFrame(() => {
      const f = formRef.current
      if (!f) return
      f.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
      f.querySelector<HTMLElement>('input, textarea, select, button[aria-pressed], [role=radio]')?.focus({ preventScroll: true })
    })
  }

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

  const swapRef = useSmoothHeight(target)

  return (
    <>
      {!expanded && <PageHeader
        eyebrow="Подача и история заявок"
        title="Заявки и справки"
        actions={
          <>
            <ThemeButton />
            <IconButton icon="bell" label="Уведомления" to="/student/notifications" dot={unreadCount > 0} />
          </>
        }
      />}
      <div className={`grid-half grid-half--req ${expanded ? 'grid-half--solo' : ''}`}>
        <form ref={formRef} className="card" onSubmit={submit} noValidate hidden={expanded}>
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

        {target === 'teacher' ? (
          <section className="card">
            <div className="card__head card__head--wrap">
              <h2 className="card__title card__title--lg">Мои обращения{inquiries.length > 0 && <span className="card__count"> · {inquiries.length}</span>}</h2>
            </div>
            <InquiryThreads teachers={teachers} />
          </section>
        ) : (
          <MyRequests requests={requests} expanded={expanded} onExpand={expand} onCollapse={collapse} onNew={startNew} targetId={targetId} />
        )}
      </div>
      <Disclaimer />
    </>
  )
}
