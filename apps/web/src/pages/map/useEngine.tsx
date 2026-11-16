import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Callbacks, Intro, MapEngine, SceneState } from './gl/engine'
import { MapIcon, type MapIconName } from './MapIcon'

import { EngineCtx, useEngine } from './engineCtx'

/** Движок 3D грузится отдельным куском и живёт, пока открыта вкладка «Карта»: холст переезжает между уровнями. */
export function EngineProvider({ children }: { children: ReactNode }) {
  const [engine, setEngine] = useState<MapEngine | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let dead = false
    let eng: MapEngine | null = null
    import('./gl/engine')
      .then((m) => {
        if (dead) return
        if (!m.webglOk()) return setFailed(true)
        try {
          eng = new m.MapEngine()
          setEngine(eng)
        } catch {
          setFailed(true)
        }
      })
      .catch(() => { if (!dead) setFailed(true) })
    return () => {
      dead = true
      eng?.destroy()
    }
  }, [])
  return <EngineCtx.Provider value={{ engine, failed }}>{children}</EngineCtx.Provider>
}

function Ctl({ icon, label, onClick }: { icon: MapIconName; label: string; onClick: () => void }) {
  return (
    <button type="button" className="cm-ctl__b" data-rot={icon === 'rotl' || icon === 'rotr' ? '' : undefined} aria-label={label} title={label} onClick={onClick}>
      <MapIcon name={icon} size={18} sw={2} />
    </button>
  )
}

interface StageProps {
  state: SceneState
  intro?: Intro
  cbs: Callbacks
  wide?: boolean
  children?: ReactNode
}

/** Место под 3D-карту: сюда переезжает холст, поверх лежат кнопки управления видом и карточки. */
export function Stage3D({ state, intro = 'none', cbs, wide, children }: StageProps) {
  const { engine, failed } = useEngine()
  const ref = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const introRef = useRef(intro)

  useLayoutEffect(() => {
    if (!engine || !ref.current) return
    engine.attach(ref.current)
    setReady(true)
  }, [engine])
  useLayoutEffect(() => {
    introRef.current = intro
    engine?.setCallbacks(cbs)
  })
  useLayoutEffect(() => {
    if (engine && ready) engine.set(state, introRef.current)
  }, [engine, ready, state])

  // телефон: при выборе карта подъезжает к верху экрана, чтобы нижняя шторка её не закрывала
  const sel = state.sel
  useEffect(() => {
    if (!sel || !ref.current || !matchMedia('(max-width: 759px)').matches) return
    ref.current.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [sel])

  return (
    <div className={`cm-stage${wide ? ' cm-stage--wide' : ''}`} ref={ref} role="group" aria-label="Объёмная карта. Всё на ней доступно кнопками и списком справа.">
      {!engine && !failed && <div className="cm-skel" role="status"><span className="cm-skel__bar" />Загружаю объёмную карту…</div>}
      {failed && <div className="cm-skel" role="status">Объёмная карта недоступна в этом браузере. Список справа работает так же: выберите кампус или место.</div>}
      {engine && (
        <div className="cm-ctl" role="group" aria-label="Вид карты">
          <Ctl icon="plus" label="Приблизить" onClick={() => engine.zoomBy(1.35)} />
          <Ctl icon="minus" label="Отдалить" onClick={() => engine.zoomBy(1 / 1.35)} />
          <Ctl icon="rotl" label="Повернуть влево" onClick={() => engine.rotate(-1)} />
          <Ctl icon="rotr" label="Повернуть вправо" onClick={() => engine.rotate(1)} />
          <Ctl icon="home" label="Сбросить вид" onClick={() => engine.reset()} />
        </div>
      )}
      {children}
    </div>
  )
}
