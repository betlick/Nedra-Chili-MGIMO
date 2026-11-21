import { useEffect, useMemo, useRef, useState } from 'react'
import { downloadFile } from '../lib/api'
import { REQUEST_ICONS, REQUEST_STAGES, REQUEST_TYPES } from '../data/mock'
import { addDays, dayMonth } from '../lib/format'
import { SLA_DAYS, STATUS_LABEL } from '../lib/staff'
import { useData } from '../context/data'
import { useToast } from '../context/toast'
import { useIndicator } from '../lib/useIndicator'
import type { StudentRequest } from '../types'
import { Badge, Button } from './ui'
import { Icon } from './Icon'

type Filter = 'all' | 'active' | 'ready'
const PREVIEW = 3

const isActive = (r: StudentRequest) => r.status === 'submitted' || r.status === 'in_progress'
const isReady = (r: StudentRequest) => r.status === 'ready' || r.status === 'issued'
/** Короткий номер — тот же, что видит сотрудник деканата. */
const numberOf = (r: StudentRequest) => r.id.slice(0, 4).toUpperCase()
const tone = (r: StudentRequest) => (isReady(r) ? 'ok' : r.status === 'rejected' ? 'danger' : r.status === 'in_progress' ? 'warn' : r.status === 'cancelled' ? 'neutral' : 'accent') as 'ok' | 'danger' | 'warn' | 'neutral' | 'accent'

function dueLabel(r: StudentRequest) {
  if (!r.createdAt) return ''
  return dayMonth(addDays(new Date(r.createdAt), SLA_DAYS))
}

/** Строка состояния под названием: что происходит с заявкой и что делать дальше. */
function statusLine(r: StudentRequest) {
  const due = dueLabel(r)
  switch (r.status) {
    case 'submitted': return `Принята${due ? ` · ответим до ${due}` : ''}`
    case 'in_progress': return `В работе${due ? ` · готовность до ${due}` : ''}`
    case 'ready': return r.delivery === 'pdf' ? 'Готова · можно скачать PDF' : 'Готова · заберите в деканате'
    case 'issued': return r.delivery === 'pdf' ? 'Выдана · PDF доступен' : 'Выдана'
    case 'rejected': return r.rejectionReason ? `Отклонена · ${r.rejectionReason}` : 'Отклонена'
    default: return 'Отменена'
  }
}

function Row({ r, open, onToggle, target }: { r: StudentRequest; open: boolean; onToggle: () => void; target: boolean }) {
  const { cancelRequest } = useData()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const done = isReady(r)
  const off = r.status === 'cancelled' || r.status === 'rejected'
  const detailsId = `req-details-${r.id}`
  const download = async (path: string, name: string) => {
    setDownloading(path)
    try { await downloadFile(path, name) }
    catch (e) { toast(e instanceof Error ? e.message : 'Не удалось скачать файл. Попробуйте ещё раз.') }
    finally { setDownloading(null) }
  }
  const pdfPath = `/api/requests/${r.id}/pdf`
  const processing = r.status === 'submitted' && ['queued', 'processing'].includes(r.automationReason ?? '')
  const cancel = async () => {
    setBusy(true)
    if (await cancelRequest(r.id)) toast('Заявка отменена')
    setBusy(false)
    setConfirm(false)
  }
  return (
    <li id={`req-${r.id}`} className={`myreq__row ${isActive(r) ? 'is-active' : ''} ${target ? 'is-target' : ''}`} tabIndex={target ? -1 : undefined} aria-current={target ? 'true' : undefined}>
      <span className={`myreq__tile ${done ? 'is-done' : off ? 'is-off' : ''}`} aria-hidden="true">
        <Icon name={done ? 'check' : off ? 'x' : REQUEST_ICONS[r.type]} size={22} />
      </span>
      <div className="myreq__main">
        <h3>
          <button type="button" className="myreq__title" aria-expanded={open} aria-controls={detailsId} onClick={onToggle}>
            {REQUEST_TYPES[r.type]}
            <Icon name="chevronDown" size={16} className="myreq__chev" aria-hidden="true" />
          </button>
        </h3>
        <p className="myreq__meta">
          <span>№ {numberOf(r)}</span>
          <span>{r.createdLabel.replace(/\s?МСК$/, '').replace(/,\s?\d{2}:\d{2}:\d{2}$/, '')}</span>
          <span>{r.delivery === 'pdf' ? 'PDF' : 'Бумажная'}</span>
        </p>
        {!off && (
          <div className="myreq__prog">
            <span className="myreq__bar" role="img" aria-label={`Этап ${r.stage + 1} из ${REQUEST_STAGES.length}: ${REQUEST_STAGES[r.stage]}`}>
              {REQUEST_STAGES.map((s, i) => <i key={s} className={i <= r.stage ? 'is-on' : ''} />)}
            </span>
            <span className="myreq__state">{processing ? 'Принята · готовим документ, результат появится здесь' : statusLine(r)}</span>
          </div>
        )}
        {off && <p className="myreq__state">{statusLine(r)}</p>}
      </div>
      <div className="myreq__aside">
        <Badge tone={tone(r)}>{STATUS_LABEL[r.status]}</Badge>
        {done && r.delivery === 'pdf' ? (
          <Button variant="primary" icon="download" size="sm" disabled={!!downloading} onClick={() => void download(pdfPath, `request-${r.id}.pdf`)}>{downloading === pdfPath ? 'Скачиваем PDF…' : 'Скачать PDF'}</Button>
        ) : r.status === 'submitted' ? (
          confirm ? (
            <span className="myreq__confirm" role="group" aria-label="Подтвердите отмену">
              <Button variant="danger" size="sm" disabled={busy} onClick={() => void cancel()}>Да, отменить</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Оставить</Button>
            </span>
          ) : (
            <button type="button" className="myreq__link myreq__link--danger" onClick={() => setConfirm(true)}>
              <Icon name="x" size={15} aria-hidden="true" />
              Отменить
            </button>
          )
        ) : (
          <button type="button" className="myreq__link" aria-expanded={open} aria-controls={detailsId} onClick={onToggle}>
            {open ? 'Свернуть' : 'Подробнее'}
          </button>
        )}
      </div>
      {open && (
        <div id={detailsId} className="myreq__details">
          <dl>
            <dt>Цель</dt>
            <dd>{r.purpose}</dd>
            {r.comment && (<><dt>Комментарий</dt><dd>{r.comment}</dd></>)}
            {r.rejectionReason && (<><dt>Причина отказа</dt><dd role="alert">{r.rejectionReason}</dd></>)}
          </dl>
          {r.automatedAt && <p className="small">Справка подготовлена автоматически. Реквизиты сверены с учебным профилем.</p>}
          {r.preparedAvailable && <p className="small muted">Заявление подготовлено. Оно ожидает решения сотрудника и не подтверждает допуск к пересдаче.</p>}
          {processing && <p className="small" role="status">Заявка принята. Подготавливаем документ — результат появится здесь автоматически.</p>}
          {r.aiNote && !processing && <details><summary>Обработка заявки</summary><p style={{ whiteSpace: 'pre-wrap' }}>{r.aiNote}</p></details>}
          <div className="myreq__files">
            {r.preparedAvailable && (
              <>
                <Button variant="surface" size="sm" icon="download" disabled={!!downloading} onClick={() => void download(`/api/requests/${r.id}/prepared/pdf`, 'application-awaiting-decision.pdf')}>{downloading === `/api/requests/${r.id}/prepared/pdf` ? 'Скачиваем…' : 'Заявление PDF'}</Button>
                <Button variant="surface" size="sm" disabled={!!downloading} onClick={() => void download(`/api/requests/${r.id}/prepared/docx`, 'application-awaiting-decision.docx')}>{downloading === `/api/requests/${r.id}/prepared/docx` ? 'Скачиваем…' : 'Заявление DOCX'}</Button>
              </>
            )}
            {done && r.delivery === 'pdf' && r.docxAvailable && (
              <Button variant="surface" size="sm" icon="download" disabled={!!downloading} onClick={() => void download(`/api/requests/${r.id}/docx`, `request-${r.id}.docx`)}>{downloading === `/api/requests/${r.id}/docx` ? 'Скачиваем…' : 'Скачать DOCX'}</Button>
            )}
            {r.status === 'in_progress' && (
              confirm ? (
                <span className="myreq__confirm" role="group" aria-label="Подтвердите отмену">
                  <Button variant="danger" size="sm" disabled={busy} onClick={() => void cancel()}>Да, отменить заявку</Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Оставить</Button>
                </span>
              ) : (
                <Button variant="danger" size="sm" onClick={() => setConfirm(true)}>Отменить заявку</Button>
              )
            )}
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * «Мои заявки»: в карточке последние три, остальные — по кнопке «Показать все»,
 * которая раскрывает список на всю рабочую область (форма и шапка страницы скрываются).
 */
export function MyRequests({ requests, expanded, onExpand, onCollapse, onNew, targetId }: {
  requests: StudentRequest[]
  expanded: boolean
  onExpand: () => void
  onCollapse: () => void
  onNew: () => void
  targetId: string | null
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const headRef = useRef<HTMLHeadingElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const wasExpanded = useRef(expanded)
  const chips = useIndicator<HTMLDivElement>(filter)

  const sorted = useMemo(() => [...requests].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')), [requests])
  const counts = { all: sorted.length, active: sorted.filter(isActive).length, ready: sorted.filter(isReady).length }
  const found = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sorted.filter((r) => {
      if (filter === 'active' && !isActive(r)) return false
      if (filter === 'ready' && !isReady(r)) return false
      if (!q) return true
      return [REQUEST_TYPES[r.type], numberOf(r), STATUS_LABEL[r.status], r.purpose].some((s) => s.toLowerCase().includes(q.replace(/^№\s*/, '')))
    })
  }, [sorted, filter, query])
  const shown = expanded ? found : found.slice(0, PREVIEW)
  const hidden = found.length - shown.length

  // переход по ссылке из уведомления: раскрыть список, если нужная заявка не в первых трёх, и подсветить её
  const scrolledTo = useRef<string | null>(null)
  useEffect(() => {
    if (!targetId || scrolledTo.current === targetId) return
    const i = sorted.findIndex((r) => r.id === targetId)
    if (i < 0) return
    setFilter('all')
    setQuery('')
    if (i >= PREVIEW && !expanded) { onExpand(); return }
    scrolledTo.current = targetId
    requestAnimationFrame(() => {
      const el = document.getElementById(`req-${targetId}`)
      if (!el) return
      el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
      el.focus({ preventScroll: true })
    })
  }, [targetId, sorted, expanded, onExpand])

  // фокус: при раскрытии — на заголовок, при сворачивании — обратно на «Показать все»
  useEffect(() => {
    if (expanded && !wasExpanded.current) headRef.current?.focus({ preventScroll: true })
    if (!expanded && wasExpanded.current) moreRef.current?.focus({ preventScroll: true })
    wasExpanded.current = expanded
  }, [expanded])

  // «/» — к поиску, Esc в раскрытом виде — назад
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); searchRef.current?.focus() }
      else if (e.key === 'Escape' && expanded && !typing) onCollapse()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [expanded, onCollapse])

  const filters: [Filter, string][] = [['all', 'Все'], ['active', 'Активные'], ['ready', 'Готовые']]
  return (
    <section className={`card myreq ${expanded ? 'myreq--full' : ''}`} aria-labelledby="myreq-title">
      <header className="myreq__head">
        <h2 id="myreq-title" ref={headRef} tabIndex={-1} className="card__title card__title--lg">
          Мои заявки <span className="myreq__count">{counts.all}</span>
        </h2>
        {expanded && <Button variant="ghost" icon="chevronLeft" onClick={onCollapse}>Назад</Button>}
        <Button variant="primary" icon="plus" onClick={onNew}>Новая заявка</Button>
      </header>

      <div className="myreq__tools">
        <label className="myreq__search">
          <Icon name="search" size={18} aria-hidden="true" />
          <input ref={searchRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти по названию или номеру" aria-label="Поиск по заявкам" autoComplete="off" />
          <kbd aria-hidden="true">/</kbd>
        </label>
        <div ref={chips.box} className="chips" role="radiogroup" aria-label="Фильтр заявок">
          <span ref={chips.ind} className="chips__ind" aria-hidden="true" />
          {filters.map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={filter === v} className={`chip ${filter === v ? 'is-active' : ''}`} onClick={() => setFilter(v)}>
              {l}
              {v !== 'all' && <span className="chip__n">{counts[v]}</span>}
            </button>
          ))}
        </div>
      </div>

      {counts.all === 0 ? (
        <div className="myreq__empty">
          <b>Заявок пока нет</b>
          <p className="muted">Выберите, что нужно оформить, и отправьте заявку: статус появится здесь.</p>
        </div>
      ) : found.length === 0 ? (
        <div className="myreq__empty">
          <b>Ничего не найдено</b>
          <p className="muted">{query.trim() ? `По запросу «${query.trim()}» заявок нет.` : 'В этом фильтре заявок нет.'}</p>
          <Button variant="surface" size="sm" onClick={() => { setQuery(''); setFilter('all') }}>Сбросить поиск и фильтр</Button>
        </div>
      ) : (
        <ul className="myreq__list">
          {shown.map((r) => (
            <Row key={r.id} r={r} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)} target={r.id === targetId} />
          ))}
        </ul>
      )}

      {counts.all > 0 && found.length > 0 && (
        <footer className="myreq__foot">
          <p className="small muted" role="status">
            {expanded || hidden === 0 ? `Показано ${found.length} из ${counts.all}` : `Показаны последние ${shown.length} из ${found.length}`}
          </p>
          {!expanded && hidden > 0 && (
            <Button ref={moreRef} variant="surface" iconRight="chevronDown" onClick={onExpand}>Показать все</Button>
          )}
        </footer>
      )}
    </section>
  )
}
