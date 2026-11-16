import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import logo from '../../assets/logo-full.webp'
import { EngineProvider } from '../map/useEngine'
import { useEngine } from '../map/engineCtx'
import type { CampusId } from '../map/data'
import type { Callbacks, SceneState } from '../map/gl/engine'
import './welcome.css'

gsap.registerPlugin(ScrollTrigger)

interface Step {
  id: string
  campus: CampusId | null
  az: number
  k: number
  kicker: string
  title: string
  text: string
  points?: string[]
}

const STEPS: Step[] = [
  {
    id: 'hero', campus: null, az: Math.PI / 4, k: 1,
    kicker: 'МУКПиД · Цифровой деканат',
    title: 'Весь университет на одной карте',
    text: 'Расписание, заявки, оценки и объявления деканата в одном окне. Крутите карту, а ниже листайте: мы покажем, где что живёт.',
  },
  {
    id: 'main', campus: 'main', az: Math.PI / 4 - 0.5, k: 2.1,
    kicker: 'Главный кампус',
    title: 'Расписание, оценки и материалы',
    text: 'Четыре корпуса вокруг площади. Студент видит свой день по парам, баллы по дисциплинам и файлы преподавателей.',
    points: ['Расписание на неделю и сегодня', 'Оценки и баллы по дисциплинам', 'Материалы и дедлайны'],
  },
  {
    id: 'river', campus: 'river', az: Math.PI / 4 + 0.6, k: 2.3,
    kicker: 'Кампус «Набережная»',
    title: 'Заявки и обращения без очередей',
    text: 'Справка, перевод, пересдача — заявка уходит в деканат, статус виден в приложении, ответ приходит уведомлением.',
    points: ['Заявки с вложениями', 'Статусы и история', 'Уведомления в браузере'],
  },
  {
    id: 'park', campus: 'park', az: Math.PI / 4 - 0.9, k: 2.2,
    kicker: 'Кампус «Парковый»',
    title: 'Объявления и задачи деканата',
    text: 'Сотрудники ведут расписание групп, публикуют новости и закрывают задачи. Преподаватель ставит оценки и принимает обращения.',
    points: ['Редактор расписания групп', 'Новости с обложками', 'Журнал оценок'],
  },
  {
    id: 'map', campus: null, az: Math.PI / 4, k: 1.1,
    kicker: 'Карта университета',
    title: 'Найдите любую аудиторию',
    text: 'Три кампуса, этажи и маршрут от входа до двери. Это та же карта, что внутри приложения. Войдите и откройте её.',
  },
]

const phone = () => matchMedia('(max-width: 759px)').matches

function Showcase() {
  const { engine, failed } = useEngine()
  const stageRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const activeRef = useRef(0)

  const goTo = (i: number) => document.getElementById(`wl-${STEPS[i].id}`)?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })

  const cbs = useMemo<Callbacks>(
    () => ({
      campus: (id) => { const i = STEPS.findIndex((s) => s.campus === id); if (i >= 0) goTo(i) },
      building() {}, marker() {}, room() {}, bg() {},
    }),
    [],
  )

  // фон body с fixed-вложением перерисовывается на каждом кадре прокрутки: на витрине он закрыт картой
  useEffect(() => {
    document.documentElement.classList.add('wl-active')
    return () => document.documentElement.classList.remove('wl-active')
  }, [])

  // холст уезжает на фон витрины
  useEffect(() => {
    if (!engine || !stageRef.current) return
    engine.attach(stageRef.current)
    engine.setCallbacks(cbs)
    engine.set({ level: 'territory', sel: null } satisfies SceneState, 'in')
    if (import.meta.env.DEV) (window as unknown as { __eng: unknown }).__eng = engine
    engine.setShowcase(true)
    engine.setInset(phone() ? window.innerHeight * 0.2 : 0)
    return () => engine.setShowcase(false)
  }, [engine, cbs])

  // камера следует за прокруткой, текст появляется по шагам
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const mm = gsap.matchMedia()
    const ctx = gsap.context(() => {
      const secs = gsap.utils.toArray<HTMLElement>('.wl-step')
      secs.forEach((sec, i) => {
        const step = STEPS[i]
        const show = () => {
          activeRef.current = i
          setActive(i)
          if (!engine) return
          engine.set({ level: 'territory', sel: step.campus })
          engine.tour(step.campus, { az: step.az, k: step.k, dx: phone() ? 0 : Math.min(260, innerWidth * 0.17) })
        }
        ScrollTrigger.create({ trigger: sec, start: 'top 55%', end: 'bottom 55%', onEnter: show, onEnterBack: show })
        mm.add('(prefers-reduced-motion: no-preference)', () => {
          const parts = sec.querySelectorAll('.wl-card > *')
          gsap.from(parts, {
            y: 22, opacity: 0, duration: 0.6, ease: 'power3.out', stagger: 0.08,
            scrollTrigger: { trigger: sec, start: 'top 60%', toggleActions: 'play none none reverse' },
          })
        })
      })
    }, root)
    ScrollTrigger.refresh()
    return () => { ctx.revert(); mm.revert() }
  }, [engine])

  return (
    <div className="wl" ref={rootRef}>
      <div className="wl-stage" ref={stageRef} aria-hidden={!engine || failed ? undefined : true}>
        {failed && <p className="wl-fail">Объёмная карта недоступна в этом браузере, но всё остальное работает.</p>}
      </div>

      <header className="wl-top">
        <Link to="/welcome" className="wl-brand" aria-label="МУКПиД, на главную">
          <img src={logo} alt="" width="36" height="36" />
          <span><b>МУКПиД</b><small>Онлайн деканат</small></span>
        </Link>
        <Link to="/login" className="btn btn--primary btn--sm">Войти</Link>
      </header>

      <nav className="wl-dots" aria-label="Разделы">
        {STEPS.map((s, i) => (
          <button key={s.id} type="button" aria-label={s.kicker} aria-current={active === i || undefined} onClick={() => goTo(i)} />
        ))}
      </nav>

      <main className="wl-steps">
        {STEPS.map((s, i) => (
          <section key={s.id} id={`wl-${s.id}`} className="wl-step" aria-labelledby={`wl-t-${s.id}`}>
            <div className="wl-card">
              <p className="wl-kicker">{s.kicker}</p>
              {i === 0 ? <h1 id={`wl-t-${s.id}`}>{s.title}</h1> : <h2 id={`wl-t-${s.id}`}>{s.title}</h2>}
              <p className="wl-text">{s.text}</p>
              {s.points && (
                <ul className="wl-points">
                  {s.points.map((p) => <li key={p}>{p}</li>)}
                </ul>
              )}
              {(i === 0 || i === STEPS.length - 1) && (
                <div className="wl-cta">
                  <Link to="/login" className="btn btn--primary btn--md">Войти в деканат</Link>
                  {i === 0 && <button type="button" className="btn btn--ghost btn--md" onClick={() => goTo(1)}>Смотреть дальше</button>}
                </div>
              )}
            </div>
          </section>
        ))}
        <p className="wl-foot">Схема вымышленная. МУКПиД — учебный концепт: кампусы, аудитории и расписание придуманы.</p>
      </main>
    </div>
  )
}

export function WelcomePage() {
  return (
    <EngineProvider>
      <Showcase />
    </EngineProvider>
  )
}
