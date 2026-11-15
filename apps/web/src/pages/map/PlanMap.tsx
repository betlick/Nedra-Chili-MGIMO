import { memo } from 'react'
import { PLANS, ROOM, catOf, plural, roomTitle, FORMS, type BuildingId, type Room } from './data'
import { IconG } from './MapIcon'
import { press, wrap } from './helpers'

const PW = 940, X0 = 30, TOP = 40, H = 195, BOT = 285
const CORRIDOR = (TOP + H + BOT) / 2

interface Slot { r: Room; x: number; y: number; w: number; h: number; side: 'top' | 'bot' }

export function layoutPlan(b: BuildingId, f: number): Slot[] {
  const p = PLANS[b][f]
  const out: Slot[] = []
  for (const side of ['top', 'bot'] as const) {
    const items = p[side].map((e) => {
      const [i, w] = e.split(':')
      return { r: ROOM[i], w: +w }
    })
    const sum = items.reduce((a, x) => a + x.w, 0)
    let x = X0
    for (const it of items) {
      const w = (it.w / sum) * PW
      out.push({ r: it.r, x, y: side === 'top' ? TOP : BOT, w, h: H, side })
      x += w
    }
  }
  return out
}

/* Маршрут от входа (1 этаж) или от лифта (выше) до двери выбранного помещения. */
function routePath(slots: Slot[], f: number, id: string): { d: string; sx: number; sy: number; ex: number; ey: number } | null {
  const t = slots.find((s) => s.r.id === id)
  if (!t || t.r.cat === 'util') return null
  const start = f === 1 ? slots.find((s) => /-hall$/.test(s.r.id)) : slots.find((s) => /lift/.test(s.r.id))
  if (!start) return null
  const door = (s: Slot) => (s.side === 'top' ? s.y + s.h : s.y)
  const sx = start.x + start.w / 2
  const sy = f === 1 ? BOT + H + 30 : door(start)
  const tx = t.x + t.w / 2
  const ty = door(t)
  const pts: [number, number][] = [[sx, sy]]
  if (f === 1) pts.push([sx, start.r.id === id ? door(start) : CORRIDOR])
  else pts.push([sx, CORRIDOR])
  if (start.r.id !== id) {
    pts.push([tx, CORRIDOR], [tx, ty])
  }
  return { d: 'M' + pts.map((p) => p.join(' ')).join(' L'), sx, sy, ex: pts[pts.length - 1][0], ey: pts[pts.length - 1][1] }
}

interface Props {
  b: BuildingId
  f: number
  sel: string | null
  filtering: boolean
  match: (r: Room) => boolean
  onPick: (id: string) => void
}

/* План этажа. Ключ b-f перемонтирует группу, поэтому помещения «въезжают» по очереди при смене этажа. */
export const PlanMap = memo(function PlanMap({ b, f, sel, filtering, match, onPick }: Props) {
  const slots = layoutPlan(b, f)
  const route = sel && ROOM[sel] && ROOM[sel].b === b && ROOM[sel].f === f ? routePath(slots, f, sel) : null
  return (
    <svg className="cm-svg" viewBox="0 0 1000 530" role="group" aria-label={`План: корпус ${b}, ${f} этаж`}>
      <rect width={1000} height={530} fill="var(--cm-ground)" />
      <g key={`${b}-${f}`}>
        <rect x={X0 - 8} y={TOP - 8} width={PW + 16} height={H * 2 + (BOT - TOP - H) + 16} rx={22} fill="var(--cm-road)" stroke="var(--ink)" strokeWidth={3} />
        <line x1={X0 + 16} x2={X0 + PW - 16} y1={CORRIDOR} y2={CORRIDOR} stroke="var(--line-solid)" strokeWidth={2} strokeDasharray="2 10" strokeLinecap="round" />
        {slots.map(({ r, x, y, w, h, side }, i) => {
          const util = r.cat === 'util'
          const dim = filtering && !util && !match(r)
          const on = sel === r.id
          const dw = Math.min(30, w * 0.4)
          const dy = side === 'top' ? y + h - 4 : y - 4
          const fs = w < 120 ? 13 : 14.5
          const lines = util ? [] : wrap(r.name, Math.max(6, Math.floor((w - 20) / (fs * 0.6))))
          const a11y = util ? {} : { role: 'button', tabIndex: 0, 'aria-pressed': on, 'aria-label': `${roomTitle(r)}, ${catOf(r.cat as never).name}` }
          return (
            <g key={r.id} className={`cm-room${dim ? ' is-dim' : ''}`} data-id={r.id} style={{ ['--i' as string]: i }} {...a11y} {...(util ? {} : press(() => onPick(r.id)))}>
              <g className="cm-room__in">
                <rect
                  className="cm-ring"
                  x={x + 1.5} y={y + 1.5} width={w - 3} height={h - 3} rx={6}
                  style={util ? { fill: 'var(--surface-2-solid)', stroke: 'var(--cm-util)' } : { fill: `color-mix(in oklab, var(--cm-${r.cat}) ${on ? 40 : 18}%, var(--surface-solid))`, stroke: `var(--cm-${r.cat})` }}
                  strokeWidth={on ? 4 : 1.5}
                />
                <rect x={x + w / 2 - dw / 2} y={dy} width={dw} height={8} fill="var(--cm-road)" />
                {util ? (
                  <g style={{ color: 'var(--ink-3)' }}>
                    {/lift/.test(r.id) ? <IconG name="stairs" x={x + w / 2} y={y + h / 2} s={22} /> : <text className="lbl muted" x={x + w / 2} y={y + h / 2 + 5} textAnchor="middle" fontSize={13} fontWeight={800}>WC</text>}
                  </g>
                ) : (
                  <>
                    <g style={{ color: 'var(--ink)' }}><IconG name={r.cat as never} x={x + 20} y={y + 22} s={18} /></g>
                    <text className="lbl" fontSize={fs} fontWeight={700}>
                      {lines.map((ln, li) => <tspan key={li} x={x + 12} y={y + 52 + li * (fs + 3)}>{ln}</tspan>)}
                    </text>
                    {/^\w-\d{3}$/.test(r.id) && <text className="lbl muted" x={x + 12} y={y + h - 14} fontSize={12.5} fontWeight={800}>{r.id}</text>}
                    {r.cap > 0 && w >= 90 && <text className="lbl muted" x={x + w - 12} y={y + h - 14} fontSize={12} fontWeight={600} textAnchor="end">{plural(r.cap, FORMS.place)}</text>}
                  </>
                )}
              </g>
            </g>
          )
        })}
        {f === 1 && slots.filter((s) => /-hall$/.test(s.r.id)).map((s) => (
          <g key="entry" style={{ color: 'var(--ink)' }}>
            <IconG name="gate" x={s.x + s.w / 2 - 44} y={BOT + H + 36} s={18} />
            <text className="lbl" x={s.x + s.w / 2 - 28} y={BOT + H + 41} fontSize={13} fontWeight={800}>Главный вход</text>
          </g>
        ))}
        {route && (
          <g className="cm-route" key={sel} aria-hidden="true">
            <path d={route.d} pathLength={1} className="cm-route__line" fill="none" stroke="var(--ink)" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={route.sx} cy={route.sy} r={7} fill="var(--hl)" stroke="var(--ink)" strokeWidth={2.5} />
            <circle className="cm-route__end" cx={route.ex} cy={route.ey} r={7} fill="var(--ink)" />
          </g>
        )}
      </g>
    </svg>
  )
})
