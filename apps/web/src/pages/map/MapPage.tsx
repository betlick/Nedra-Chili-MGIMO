import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams, type NavigateOptions } from 'react-router-dom'
import { Card, PageHeader, ThemeButton } from '../../components/ui'
import { useUser } from '../../context/auth'
import {
  BUILDINGS, CAMPUSES, CATS, FORMS, ROOM, ROOMS, campusOf, catOf, norm, plural, roomSearchText, roomTitle,
  type BuildingId, type CampusId, type CatId, type Room,
} from './data'
import { MapIcon } from './MapIcon'
import { EngineProvider, Stage3D } from './useEngine'
import { useDive } from './engineCtx'
import type { Callbacks, SceneState } from './gl/engine'
import { canViewTransition, isPhone, reducedMotion } from './helpers'
import './map.css'

type Say = (text: string) => void

/* ───────────── маршрут: /map, /map/main, /map/main/A, /map/main/A/2 ───────────── */
function useMapRoute() {
  const params = useParams()
  const seg = (params['*'] ?? '').split('/').filter(Boolean)
  const campus = seg[0] && seg[0] in CAMPUSES ? (seg[0] as CampusId) : null
  const bRaw = seg[1] as BuildingId | undefined
  const b = campus && bRaw && BUILDINGS[bRaw]?.c === campus ? bRaw : null
  const floors = b ? BUILDINGS[b].floors : 1
  const f = b ? Math.min(floors, Math.max(1, Number(seg[2]) || 1)) : 1
  return { campus, b, f }
}

function Crumbs({ items }: { items: { label: string; onClick?: () => void }[] }) {
  return (
    <nav className="cm-crumbs" aria-label="Где вы на карте">
      <ol>
        {items.map((it, i) => (
          <li key={i}>
            {it.onClick ? <button type="button" onClick={it.onClick}>{it.label}</button> : <span aria-current="page">{it.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

function Row({ r, current, tag, onPick }: { r: Room; current?: boolean; tag?: string; onPick: (r: Room) => void }) {
  return (
    <button type="button" className="cm-row" style={{ ['--c' as string]: `var(--cm-${r.cat})` }} aria-current={current || undefined} onClick={() => onPick(r)}>
      <span className="cm-dot"><MapIcon name={r.cat === 'util' ? 'util' : r.cat} size={16} /></span>
      <span><b>{roomTitle(r)}</b><small>{catOf(r.cat as CatId).name}</small></span>
      <span className="cm-tag-text">{tag}</span>
    </button>
  )
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <>
      {title && <h3 className="cm-group">{title}</h3>}
      <ul className="cm-list">{children}</ul>
    </>
  )
}

/* ═════════════════════════ ТЕРРИТОРИЯ ═════════════════════════ */
function TerritoryView({ zoomFrom, onOpen, onRoom, say }: { zoomFrom: CampusId | null; onOpen: (id: CampusId) => void; onRoom: (r: Room) => void; say: Say }) {
  const engine = useDive()
  const [sel, setSel] = useState<CampusId | null>(zoomFrom)
  const [q, setQ] = useState('')
  const [opening, setOpening] = useState<CampusId | null>(null)
  const busy = !!opening

  const focusPin = useCallback((id: CampusId, delay = 0) => {
    window.setTimeout(() => document.querySelector<HTMLElement>(`[data-k="campus:${id}"]`)?.focus({ preventScroll: true }), delay)
  }, [])

  // обратно с кампуса: камера отъезжает к общему виду, фокус возвращается на кампус
  useEffect(() => {
    if (zoomFrom) focusPin(zoomFrom, reducedMotion() ? 0 : 700)
  }, [zoomFrom, focusPin])

  // в кампус: камера приближается к нему, потом открывается схема кампуса
  useEffect(() => {
    if (!opening) return
    if (!engine) return onOpen(opening)
    engine.dive(opening, () => onOpen(opening))
  }, [opening, engine, onOpen])

  const pick = (id: CampusId) => {
    if (busy) return
    if (sel === id) {
      setOpening(id)
      return
    }
    setSel(id)
    say(`${CAMPUSES[id].name} выбран. Нажмите ещё раз или «Открыть карту кампуса».`)
  }
  const clear = useCallback(() => setSel(null), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || busy || !sel) return
      const t = e.target as HTMLElement | null
      if (t?.matches?.('input') && (t as HTMLInputElement).value) return
      const id = sel
      setSel(null)
      focusPin(id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, busy, focusPin])

  const state = useMemo<SceneState>(() => ({ level: 'territory', sel }), [sel])
  const cbs: Callbacks = { campus: pick, building: () => undefined, marker: () => undefined, room: () => undefined, bg: clear }

  const nq = norm(q.trim())
  const camps = Object.values(CAMPUSES).filter((c) => nq && norm(`${c.name} ${c.addr}`).includes(nq))
  const rooms = nq ? ROOMS.filter((r) => r.cat !== 'util' && norm(`${roomSearchText(r)} ${BUILDINGS[r.b].name}`).includes(nq)) : []
  const popC = sel ? CAMPUSES[sel] : null

  return (
    <div className="cm-layout" data-return={zoomFrom ? '' : undefined}>
      <Card className="cm-mapcard">
        <div className="cm-mhead">
          <div className="cm-grow">
            <h2 id="cm-th" tabIndex={-1}>Территория</h2>
            <p className="cm-sub">Три кампуса, между ними ходит шаттл</p>
          </div>
          <p className="cm-hint cm-hint--desk">Тяните карту, чтобы повернуть. Ctrl и колесо мыши меняют масштаб</p>
        </div>
        <p className="cm-hint cm-hint--touch">Проведите по карте вбок, чтобы повернуть. Щипок меняет масштаб.</p>
        <Stage3D state={state} intro={zoomFrom ? { campus: zoomFrom } : 'in'} cbs={cbs}>
          {popC && !busy && (
            <div className="cm-pop" role="group" aria-labelledby="cm-popt">
              <button type="button" className="cm-btn cm-btn--icon cm-x" aria-label="Закрыть" onClick={() => { const id = popC.id; setSel(null); focusPin(id) }}>
                <MapIcon name="x" size={16} sw={2} />
              </button>
              <div>
                <h3 id="cm-popt">{popC.name}</h3>
                <p className="cm-addr">{popC.addr}</p>
              </div>
              <p className="cm-mini">{plural(popC.bs.length, FORMS.building)}: {popC.bs.map((b) => `${b} — ${BUILDINGS[b].name}`).join(', ')}</p>
              <p className="cm-hint">{popC.how}</p>
              <button type="button" className="cm-btn cm-btn--primary" onClick={() => setOpening(popC.id)}>Открыть карту кампуса</button>
            </div>
          )}
        </Stage3D>
      </Card>

      <Card as="aside" className="cm-panel">
        <div className="cm-field">
          <label htmlFor="cm-tq">Найти место во всех кампусах</label>
          <input id="cm-tq" type="search" placeholder="Например, A-101 или столовая" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!nq ? (
          <div>
            <h2 className="cm-h2">Кампусы</h2>
            <ul className="cm-ccards">
              {Object.values(CAMPUSES).map((c, i) => {
                const n = ROOMS.filter((r) => r.cat !== 'util' && BUILDINGS[r.b].c === c.id).length
                return (
                  <li key={c.id} className="cm-ccard" data-on={sel === c.id} style={{ ['--i' as string]: i }}>
                    <div>
                      <h3>{c.name}</h3>
                      <p className="cm-addr">{c.addr}, {plural(c.bs.length, FORMS.building)}, {plural(n, FORMS.place)} на карте</p>
                    </div>
                    <div className="cm-letters">
                      {c.bs.map((b) => <span key={b}><b>{b}</b>{BUILDINGS[b].name}</span>)}
                    </div>
                    <div className="cm-acts">
                      <button type="button" className="cm-btn cm-btn--primary" disabled={busy} onClick={() => setOpening(c.id)}>Открыть карту кампуса</button>
                      <button
                        type="button"
                        className="cm-btn"
                        aria-pressed={sel === c.id}
                        onClick={() => {
                          if (sel === c.id) return setSel(null)
                          setSel(c.id)
                          say(`${c.name} выбран на карте`)
                          if (isPhone()) document.querySelector('.cm-stage')?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
                        }}
                      >
                        На карте
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          <div>
            <h2 className="cm-h2">{camps.length + rooms.length ? `Найдено: ${camps.length + rooms.length}` : 'Ничего не найдено'}</h2>
            {!camps.length && !rooms.length && <p className="cm-empty-note">Проверьте номер аудитории или попробуйте другое слово, например «коворкинг».</p>}
            {Object.values(CAMPUSES).map((c) => {
              const cr = rooms.filter((r) => BUILDINGS[r.b].c === c.id)
              const hit = camps.includes(c)
              if (!cr.length && !hit) return null
              return (
                <Group key={c.id} title={c.name}>
                  {hit && (
                    <li>
                      <button type="button" className="cm-row" style={{ ['--c' as string]: 'var(--accent-solid)' }} onClick={() => setOpening(c.id)}>
                        <span className="cm-dot"><MapIcon name="building" size={16} /></span>
                        <span><b>Карта кампуса</b><small>{c.addr}</small></span>
                        <span className="cm-tag-text" />
                      </button>
                    </li>
                  )}
                  {cr.map((r) => <li key={r.id}><Row r={r} tag={`${r.b}, ${r.f} этаж`} onPick={onRoom} /></li>)}
                </Group>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

/* ═════════════════════════ КАМПУС ═════════════════════════ */
interface CampusProps {
  campusId: CampusId
  b: BuildingId | null
  f: number
  initialSel: string | null
  go: (b: BuildingId | null, f?: number, replace?: boolean) => void
  up: () => void
  say: Say
}

function CampusView({ campusId, b, f, initialSel, go, up, say }: CampusProps) {
  const campus = CAMPUSES[campusId]
  const [cats, setCats] = useState<Set<CatId>>(new Set())
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(initialSel)
  const [siteSel, setSiteSel] = useState<BuildingId | null>(initialSel ? ROOM[initialSel].b : null)
  const filtering = cats.size > 0 || q.trim() !== ''

  const match = useCallback(
    (r: Room) => {
      if (r.cat === 'util') return false
      if (cats.size && !cats.has(r.cat)) return false
      const nq = norm(q.trim())
      return !nq || roomSearchText(r).includes(nq)
    },
    [cats, q],
  )

  const focusNode = (key: string) => window.setTimeout(() => document.querySelector<HTMLElement>(`[data-k="${key}"]`)?.focus({ preventScroll: true }), 60)

  const openBuilding = (id: BuildingId, cat?: CatId) => {
    let floor = 1
    if (cat) {
      setCats(new Set([cat]))
      floor = ROOMS.find((r) => r.b === id && r.cat === cat)?.f ?? 1
    }
    setSel(null)
    setSiteSel(id)
    go(id, floor, !!b)
    say(`Корпус ${id}, ${BUILDINGS[id].name}, ${floor} этаж`)
  }
  const toSite = () => {
    setSel(null)
    go(null)
  }
  const select = (id: string) => {
    const r = ROOM[id]
    setSel(id)
    setSiteSel(r.b)
    if (r.b !== b || r.f !== f) go(r.b, r.f, !!b)
    focusNode(`room:${id}`)
  }
  const pickBuilding = (id: BuildingId) => {
    if (siteSel === id) return openBuilding(id)
    setSiteSel(id)
    say(`Корпус ${id} выбран. Нажмите ещё раз, чтобы открыть планы этажей.`)
    focusNode(`b:${id}`)
  }
  const toggleCat = (id: CatId) => setCats((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const reset = () => { setCats(new Set()); setQ('') }

  // Esc: комната → корпус на схеме → вся схема
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t?.matches?.('input') && (t as HTMLInputElement).value) return
      if (sel) setSel(null)
      else if (b) { const id = b; toSite(); focusNode(`b:${id}`) }
      else if (siteSel) setSiteSel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const chips = useMemo(() => CATS.map((c) => ({ c, n: ROOMS.filter((r) => r.cat === c.id && campus.bs.includes(r.b)).length })).filter((x) => x.n), [campus])
  const B = b ? BUILDINGS[b] : null

  const matchIds = useMemo(
    () => (filtering ? new Set(ROOMS.filter((r) => campus.bs.includes(r.b) && match(r)).map((r) => r.id)) : null),
    [filtering, match, campus],
  )
  const sceneState = useMemo<SceneState>(
    () => (b ? { level: 'plan', campus: campusId, b, f, sel, match: matchIds } : { level: 'campus', campus: campusId, sel: siteSel, match: matchIds }),
    [b, f, campusId, sel, siteSel, matchIds],
  )
  const cbs: Callbacks = {
    campus: () => undefined,
    building: pickBuilding,
    marker: openBuilding,
    room: select,
    bg: () => { if (b) setSel(null); else setSiteSel(null) },
  }

  /* — список справа — */
  let list: ReactNode
  let listTitle: string
  const rowFor = (r: Room, tag?: string) => <li key={r.id}><Row r={r} current={sel === r.id} tag={tag} onPick={(x) => select(x.id)} /></li>
  if (filtering) {
    const items = ROOMS.filter((r) => campus.bs.includes(r.b) && match(r))
    listTitle = items.length ? `Найдено: ${items.length}` : 'Ничего не найдено'
    list = items.length ? <ul className="cm-list">{items.map((r) => rowFor(r, `${r.b}, ${r.f} этаж`))}</ul> : <p className="cm-empty-note">В этом кампусе такого нет. Снимите фильтр или поищите во всех кампусах на карте территории.</p>
  } else if (b) {
    listTitle = `Корпус ${b}, ${f} этаж`
    const items = ROOMS.filter((r) => r.b === b && r.f === f && r.cat !== 'util')
    list = CATS.map((c) => {
      const g = items.filter((r) => r.cat === c.id)
      return g.length ? <Group key={c.id} title={c.short}>{g.map((r) => rowFor(r, r.cap ? plural(r.cap, FORMS.place) : ''))}</Group> : null
    })
  } else {
    listTitle = 'Все места кампуса'
    list = (
      <>
        {(siteSel ? [siteSel] : campus.bs).map((id) => (
          <Group key={id} title={`Корпус ${id}, ${BUILDINGS[id].name}`}>{ROOMS.filter((r) => r.b === id && r.cat !== 'util').map((r) => rowFor(r, `${r.f} этаж`))}</Group>
        ))}
        {siteSel && <button type="button" className="cm-clear cm-clear--more" onClick={() => setSiteSel(null)}>Показать все корпуса</button>}
      </>
    )
  }

  /* — карточка подробностей: справа на десктопе, нижняя шторка на телефоне — */
  const sr = sel ? ROOM[sel] : null
  const sb = siteSel && !b ? BUILDINGS[siteSel] : null
  let info: ReactNode = null
  let infoColor = 'var(--accent-solid)'
  if (sr) {
    const Bs = BUILDINGS[sr.b]
    infoColor = `var(--cm-${sr.cat})`
    info = (
      <>
        <div className="cm-kind"><MapIcon name={sr.cat as CatId} size={16} />{catOf(sr.cat as CatId).name}</div>
        <h3>{roomTitle(sr)}</h3>
        <dl>
          <dt>Где</dt><dd>Корпус {sr.b} «{Bs.name}», {sr.f} этаж</dd>
          {sr.hrs && <><dt>Часы</dt><dd>{sr.hrs}</dd></>}
          {sr.cap > 0 && <><dt>Вместимость</dt><dd>{plural(sr.cap, FORMS.place)}</dd></>}
        </dl>
        {sr.note && <p>{sr.note}</p>}
        <p><b>Как пройти.</b> {Bs.how}{sr.cat !== 'util' && ' Маршрут показан на плане.'}</p>
      </>
    )
  } else if (sb) {
    const n = ROOMS.filter((r) => r.b === sb.id && r.cat !== 'util').length
    info = (
      <>
        <div className="cm-kind"><MapIcon name="building" size={16} />Корпус {sb.id}</div>
        <h3>{sb.name}</h3>
        <p>{sb.desc}.</p>
        <dl><dt>Этажей</dt><dd>{sb.floors}</dd><dt>Мест на плане</dt><dd>{n}</dd></dl>
        <p><b>Как пройти.</b> {sb.how}</p>
        <button type="button" className="cm-btn cm-btn--primary" onClick={() => openBuilding(sb.id)}>Открыть планы этажей</button>
      </>
    )
  }
  const emptyText = b ? 'Нажмите на помещение на плане: здесь появятся часы работы, вместимость и как пройти.' : 'Нажмите на корпус на схеме, чтобы узнать, что в нём, или найдите место через поиск.'

  return (
    <div className="cm-layout">
      <Card className="cm-mapcard">
        <div className="cm-mhead">
          <div className="cm-grow">
            <h2 id="cm-ch" tabIndex={-1}>{campus.name}</h2>
            <p className="cm-sub">{b ? `${campus.addr}. Корпус ${b}, ${B!.name}` : <>{campus.addr}.<span className="cm-how"> {campus.how}</span></>}</p>
          </div>
          <button type="button" className="cm-btn" onClick={up}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
            <span className="cm-back-t">Вся территория</span>
          </button>
        </div>
        <p className="cm-hint cm-hint--touch">Проведите по карте вбок, чтобы повернуть. Щипок меняет масштаб.</p>
        <Stage3D state={sceneState} intro="in" cbs={cbs} wide={!!b} />
        <div className="cm-tools">
          <div className="cm-seg" role="group" aria-label="Схема кампуса или корпус">
            <button type="button" aria-pressed={!b} onClick={() => b && toSite()}>Схема кампуса</button>
            {campus.bs.map((id) => (
              <button key={id} type="button" aria-pressed={b === id} aria-label={`Корпус ${id}, ${BUILDINGS[id].name}`} onClick={() => b !== id && openBuilding(id)}>
                <span className="cm-lt">{id}</span>{BUILDINGS[id].name}
              </button>
            ))}
          </div>
          {B && (
            <div className="cm-seg cm-seg--floors" role="group" aria-label="Этаж">
              {Array.from({ length: B.floors }, (_, i) => i + 1).map((i) => (
                <button key={i} type="button" aria-pressed={f === i} onClick={() => { if (f !== i) { setSel(null); go(b, i, true) } }}>{i} этаж</button>
              ))}
            </div>
          )}
        </div>
        {sb && (
          <div className="cm-bar">
            <p>Корпус {sb.id}, {sb.name}<small>{plural(sb.floors, FORMS.floor)}: {sb.desc.toLowerCase()}</small></p>
            <button type="button" className="cm-btn cm-btn--primary" onClick={() => openBuilding(sb.id)}>Открыть планы этажей</button>
          </div>
        )}
      </Card>

      <Card as="aside" className="cm-panel">
        <div className="cm-field">
          <label htmlFor="cm-cq">Найти место в кампусе</label>
          <input id="cm-cq" type="search" placeholder="Название или номер" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <div className="cm-headrow">
            <h2 className="cm-h2">Что ищете</h2>
            {filtering && <button type="button" className="cm-clear" onClick={reset}>Сбросить</button>}
          </div>
          <div className="cm-chips">
            {chips.map(({ c, n }) => (
              <button key={c.id} type="button" className="cm-chip" style={{ ['--c' as string]: `var(--cm-${c.id})` }} aria-pressed={cats.has(c.id)} onClick={() => toggleCat(c.id)}>
                <span className="cm-dot"><MapIcon name={c.id} size={16} /></span>{c.name}<span className="cm-n">{n}</span>
              </button>
            ))}
          </div>
        </div>
        <div aria-live="polite">
          {info ? (
            <div className="cm-info" key={sel ?? siteSel ?? ''} style={{ ['--c' as string]: infoColor }}>
              <button type="button" className="cm-btn cm-btn--icon cm-info__x" aria-label="Закрыть описание" onClick={() => { if (sel) setSel(null); else setSiteSel(null) }}><MapIcon name="x" size={16} sw={2} /></button>
              {info}
            </div>
          ) : (
            <div className="cm-info cm-info--empty">{emptyText}</div>
          )}
        </div>
        <div>
          <h2 className="cm-h2" style={{ marginBottom: 4 }}>{listTitle}</h2>
          <div>{list}</div>
        </div>
      </Card>
    </div>
  )
}

/* ═════════════════════════ СТРАНИЦА ═════════════════════════ */
export const MapPage = memo(function MapPage() {
  const role = useUser().role
  const rawNavigate = useNavigate()
  // переходы между уровнями карты — с плавным перекрёстным затуханием (View Transitions)
  const navigate = useCallback(
    (to: string, opts?: NavigateOptions) => rawNavigate(to, { ...opts, viewTransition: canViewTransition() }),
    [rawNavigate],
  )
  const location = useLocation()
  const { campus, b, f } = useMapRoute()
  const base = `/${role}/map`
  const [msg, setMsg] = useState('')
  const prevCampus = useRef<CampusId | null>(null)
  const zoomFrom = !campus ? prevCampus.current : null
  const shownCampus = useRef<CampusId | null>(campus)

  useEffect(() => { prevCampus.current = campus }, [campus])
  useEffect(() => {
    // фокус на заголовок нового уровня, но не при первом показе страницы
    if (shownCampus.current === campus) return
    shownCampus.current = campus
    document.getElementById(campus ? 'cm-ch' : 'cm-th')?.focus({ preventScroll: true })
  }, [campus])

  const say = useCallback<Say>((t) => { setMsg(''); window.setTimeout(() => setMsg(t), 30) }, [])
  const open = useCallback((id: CampusId) => navigate(`${base}/${id}`), [navigate, base])
  const goCampus = useCallback(
    (nb: BuildingId | null, nf = 1, replace = false) => {
      if (!campus) return
      navigate(nb ? `${base}/${campus}/${nb}/${nf}` : `${base}/${campus}`, { replace })
    },
    [navigate, base, campus],
  )
  const up = useCallback(() => navigate(base), [navigate, base])
  const room = useCallback((r: Room) => navigate(`${base}/${campusOf(r)}/${r.b}/${r.f}`, { state: { sel: r.id } }), [navigate, base])
  const initialSel = (location.state as { sel?: string } | null)?.sel ?? null

  const crumbs = [{ label: 'Территория', onClick: campus ? () => navigate(base) : undefined }]
  if (campus) crumbs.push({ label: CAMPUSES[campus].name, onClick: b ? () => navigate(`${base}/${campus}`) : undefined })
  if (campus && b) crumbs.push({ label: `Корпус ${b}, ${f} этаж`, onClick: undefined })

  return (
    <EngineProvider>
    <div className="cm-root">
      <PageHeader eyebrow="МУКПиД · кампусы и корпуса" title="Карта университета" actions={<ThemeButton />} />
      <Crumbs items={crumbs} />
      <p className="cm-sr" role="status" aria-live="polite">{msg}</p>
      <div className="cm-view" key={campus ?? 'territory'}>
        {campus ? (
          <CampusView campusId={campus} b={b} f={f} initialSel={initialSel} go={goCampus} up={up} say={say} />
        ) : (
          <TerritoryView zoomFrom={zoomFrom} onOpen={open} onRoom={room} say={say} />
        )}
      </div>
      <p className="cm-foot">Схема вымышленная. МУКПиД — учебный концепт: кампусы, аудитории, часы работы и вместимость придуманы.</p>
    </div>
    </EngineProvider>
  )
})
