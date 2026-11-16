import { ROOM, campusOf } from '../pages/map/data'
import type { Role } from '../types'

/** «ауд. 214» из расписания → ссылка на план этажа с маршрутом. Для «спортзал» и прочего без номера ссылки нет. */
export function roomMapLink(room: string, role: Role): { to: string; state: { sel: string } } | null {
  const n = /ауд\.\s*(\d{3})/.exec(room)?.[1]
  const r = n ? ROOM[`A-${n}`] : undefined
  if (!r) return null
  return { to: `/${role}/map/${campusOf(r)}/${r.b}/${r.f}`, state: { sel: r.id } }
}
