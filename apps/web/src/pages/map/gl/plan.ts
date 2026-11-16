/* Раскладка плана этажа и маршрут до помещения: чистые данные без three.js. Координаты 1000×530. */
import { PLANS, ROOM, type BuildingId, type Room } from '../data'

export const PW = 940, X0 = 30, TOP = 40, H = 195, BOT = 285
export const CORRIDOR = (TOP + H + BOT) / 2

export interface Slot { r: Room; x: number; y: number; w: number; h: number; side: 'top' | 'bot' }

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

/** Маршрут от входа (1 этаж) или от лифта (выше) до двери помещения: список точек (x, y) плана. */
export function routePoints(slots: Slot[], f: number, id: string): [number, number][] | null {
  const t = slots.find((s) => s.r.id === id)
  if (!t || t.r.cat === 'util') return null
  const start = f === 1 ? slots.find((s) => /-hall$/.test(s.r.id)) : slots.find((s) => /lift/.test(s.r.id))
  if (!start) return null
  const door = (s: Slot) => (s.side === 'top' ? s.y + s.h : s.y)
  const sx = start.x + start.w / 2
  const sy = f === 1 ? BOT + H + 30 : door(start)
  const tx = t.x + t.w / 2
  const pts: [number, number][] = [[sx, sy]]
  pts.push([sx, f === 1 && start.r.id === id ? door(start) : CORRIDOR])
  if (start.r.id !== id) pts.push([tx, CORRIDOR], [tx, door(t)])
  return pts
}
